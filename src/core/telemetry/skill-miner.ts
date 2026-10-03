/**
 * Skill Miner (NextCode v5)
 * Analisa logs de telemetria em busca de rotinas repetitivas ou padrões de sucesso recorrentes
 * e gera propostas de CandidateSkillProposal na UI.
 * 
 * REGRA RIGOROSA DE GOVERNANÇA:
 * A Skill NUNCA é salva diretamente no disco pela IA. A proposta é apresentada na UI
 * e requer autorização humana explícita por clique em botão.
 */

import prisma from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";

export interface SkillProposalData {
  name: string;
  description: string;
  triggerPattern: string;
  sampleContent: string;
}

export class SkillMiner {
  /**
   * Analisa a frequência de rotinas repetitivas nos logs de telemetria
   */
  public static async analyzeAndPropose(threshold: number = 3): Promise<SkillProposalData | null> {
    const logs = await prisma.telemetryLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Conta ocorrências de ações repetitivas
    const actionCounts: Record<string, number> = {};
    for (const log of logs) {
      actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
    }

    // Procura por padrão que exceda o limite de repetição
    for (const [action, count] of Object.entries(actionCounts)) {
      if (count >= threshold && !action.startsWith("system_")) {
        const name = `custom-${action.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
        
        // Verifica se a proposta já foi criada anteriormente
        const existing = await prisma.candidateSkillProposal.findFirst({
          where: { name },
        });

        if (!existing) {
          const proposal: SkillProposalData = {
            name,
            description: `Skill minerada automaticamente após detectar ${count} execuções recorrentes da rotina '${action}'.`,
            triggerPattern: `/${name}`,
            sampleContent: `---
name: ${name}
description: Skill minerada via telemetria para a rotina '${action}'.
---

# Diretrizes da Skill: ${name}

Esta habilidade otimiza a execução repetitiva de: \`${action}\`.

## Regras de Execução
- Executar validações de forma concisa.
- Manter o foco no escopo de arquivos definido.
`,
          };

          // Salva proposta pendente no banco de dados para exibição na UI
          await prisma.candidateSkillProposal.create({
            data: {
              name: proposal.name,
              description: proposal.description,
              triggerPattern: proposal.triggerPattern,
              sampleContent: proposal.sampleContent,
              status: "pending",
            },
          });

          return proposal;
        }
      }
    }

    return null;
  }

  /**
   * Analisa erros recorrentes do PRÓPRIO NextCode (falhas de auditoria Tipo 1/Tipo 2 e do
   * type-check empírico pós-promoção) agrupando por assinatura normalizada do erro — não pela
   * tarefa que falhou. Quando a MESMA assinatura se repete acima do limiar, é sinal de um bug
   * no nosso código (não um gap de skill do usuário), então gera uma CandidateSkillProposal
   * com source="bug_pattern" para aparecer na mesma tela de propostas, mas como alerta de bug
   * a ser corrigido pelo time — nunca instalada/escrita em disco como skill.
   */
  public static async detectRecurringBugs(threshold: number = 3): Promise<SkillProposalData | null> {
    const FAILURE_ACTIONS = ["AUDIT_REJECTED", "EMPIRICAL_BUILD_FAILED"];

    const logs = await prisma.telemetryLog.findMany({
      where: { action: { in: FAILURE_ACTIONS } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const signatureCounts: Record<string, { count: number; action: string; sample: string }> = {};
    for (const log of logs) {
      if (!log.details) continue;
      let parsed: { errorSignature?: string; sample?: string };
      try {
        parsed = JSON.parse(log.details);
      } catch {
        continue;
      }
      const signature = parsed.errorSignature;
      if (!signature) continue;

      if (!signatureCounts[signature]) {
        signatureCounts[signature] = { count: 0, action: log.action, sample: parsed.sample || signature };
      }
      signatureCounts[signature].count += 1;
    }

    for (const [signature, info] of Object.entries(signatureCounts)) {
      if (info.count < threshold) continue;

      const name = `bug-${signature.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`.slice(0, 60);
      const existing = await prisma.candidateSkillProposal.findFirst({ where: { name } });
      if (existing) continue;

      const proposal: SkillProposalData = {
        name,
        description: `Erro recorrente detectado ${info.count}x no próprio NextCode (${info.action}). Assinatura normalizada: ${signature}`,
        triggerPattern: "(detecção automática — não é uma skill executável)",
        sampleContent: info.sample,
      };

      await prisma.candidateSkillProposal.create({
        data: {
          name: proposal.name,
          description: proposal.description,
          triggerPattern: proposal.triggerPattern,
          sampleContent: proposal.sampleContent,
          status: "pending",
          source: "bug_pattern",
        },
      });

      return proposal;
    }

    return null;
  }

  /**
   * Aprova e instala a Skill no disco SOMENTE após autorização humana explícita.
   */
  public static async approveAndInstallSkill(proposalId: string, skillsRootDir?: string): Promise<{ success: boolean; skillPath?: string }> {
    const proposal = await prisma.candidateSkillProposal.findUnique({
      where: { id: proposalId },
    });

    if (!proposal || proposal.status !== "pending") {
      throw new Error("Proposta de Skill não encontrada ou já processada.");
    }

    const targetDir = skillsRootDir || path.join(process.cwd(), ".gemini", "skills", proposal.name);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const skillFilePath = path.join(targetDir, "SKILL.md");
    fs.writeFileSync(skillFilePath, proposal.sampleContent, "utf-8");

    // Atualiza o status no banco de dados para approved
    await prisma.candidateSkillProposal.update({
      where: { id: proposalId },
      data: { status: "approved" },
    });

    return {
      success: true,
      skillPath: skillFilePath,
    };
  }

  /**
   * Rejeita a proposta de Skill pela UI
   */
  public static async rejectProposal(proposalId: string): Promise<boolean> {
    await prisma.candidateSkillProposal.update({
      where: { id: proposalId },
      data: { status: "rejected" },
    });
    return true;
  }
}
