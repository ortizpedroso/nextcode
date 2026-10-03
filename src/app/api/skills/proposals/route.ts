import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/core/security/local-auth";
import * as fs from "fs";
import * as path from "path";
import { parseSkillContent, writeParsedSkillToDisk } from "@/core/skills/skill-installer";

export async function GET() {
  try {
    const proposals = await prisma.candidateSkillProposal.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ proposals });
  } catch (error: unknown) {
    console.error("Erro ao listar propostas de skills:", error);
    return NextResponse.json(
      { error: "Falha interna ao buscar propostas de skills", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;

  try {
    const body = await req.json();
    const { action, id, name, description, triggerPattern, sampleContent } = body;

    if (action === "create") {
      if (!name || !description || !sampleContent) {
        return NextResponse.json(
          { error: "Nome, descrição e conteúdo da skill são obrigatórios" },
          { status: 400 }
        );
      }

      const newProposal = await prisma.candidateSkillProposal.create({
        data: {
          name: name.toLowerCase().trim().replace(/[^a-z0-9-_]/g, "-"),
          description: description.trim(),
          triggerPattern: triggerPattern || `/${name}`,
          sampleContent: sampleContent.trim(),
          status: "pending",
        },
      });

      return NextResponse.json({ success: true, proposal: newProposal });
    }

    if (action === "approve") {
      if (!id) return NextResponse.json({ error: "ID da proposta é obrigatório" }, { status: 400 });

      const proposal = await prisma.candidateSkillProposal.findUnique({ where: { id } });
      if (!proposal) return NextResponse.json({ error: "Proposta não encontrada" }, { status: 404 });

      let skillFilePath: string;

      if (proposal.source === "github") {
        // Quarantine gate: só grava em disco agora, após aprovação explícita do operador.
        const parsed = parseSkillContent(proposal.sampleContent, proposal.name);
        const written = writeParsedSkillToDisk(parsed, proposal.sampleContent, proposal.targetPath);
        skillFilePath = written.installedPath;
      } else {
        // Instala a skill no diretório de skills customizadas do sistema (.gemini/config/skills/<name>/SKILL.md)
        const homeDir = process.env.USERPROFILE || process.env.HOME || "C:\\Users\\ortiz";
        const targetDir = path.join(homeDir, ".gemini", "config", "skills", proposal.name);
        fs.mkdirSync(targetDir, { recursive: true });

        skillFilePath = path.join(targetDir, "SKILL.md");
        const skillContent = `---
name: ${proposal.name}
description: ${proposal.description}
---

${proposal.sampleContent}
`;
        fs.writeFileSync(skillFilePath, skillContent, "utf-8");
      }

      const updated = await prisma.candidateSkillProposal.update({
        where: { id },
        data: { status: "approved", installedPath: skillFilePath },
      });

      return NextResponse.json({
        success: true,
        message: `Skill '/${proposal.name}' aprovada e instalada com sucesso em ${skillFilePath}`,
        proposal: updated,
      });
    }

    if (action === "reject") {
      if (!id) return NextResponse.json({ error: "ID da proposta é obrigatório" }, { status: 400 });

      const updated = await prisma.candidateSkillProposal.update({
        where: { id },
        data: { status: "rejected" },
      });

      return NextResponse.json({ success: true, proposal: updated });
    }

    if (action === "disable" || action === "enable") {
      if (!id) return NextResponse.json({ error: "ID da proposta é obrigatório" }, { status: 400 });

      const proposal = await prisma.candidateSkillProposal.findUnique({ where: { id } });
      if (!proposal) return NextResponse.json({ error: "Proposta não encontrada" }, { status: 404 });
      if (proposal.source !== "github" || !proposal.installedPath) {
        return NextResponse.json(
          { error: "Apenas skills importadas do GitHub e já instaladas podem ser desativadas/reativadas" },
          { status: 400 }
        );
      }

      const updated = await prisma.candidateSkillProposal.update({
        where: { id },
        data: { status: action === "disable" ? "disabled" : "approved" },
      });

      return NextResponse.json({
        success: true,
        message: action === "disable"
          ? `Skill '/${proposal.name}' desativada. O arquivo permanece em disco, mas deixa de ser executada.`
          : `Skill '/${proposal.name}' reativada.`,
        proposal: updated,
      });
    }

    return NextResponse.json({ error: "Ação não suportada" }, { status: 400 });
  } catch (error: unknown) {
    console.error("Erro no processamento de proposta de skill:", error);
    return NextResponse.json(
      { error: "Falha no processamento da proposta de skill", details: String(error) },
      { status: 500 }
    );
  }
}
