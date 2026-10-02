import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/security/local-auth";

export type RoleType = "ADMIN" | "DEVELOPER" | "AUDITOR";

export interface RolePermissions {
  role: RoleType;
  description: string;
  permissions: string[];
}

export const ROLE_DEFINITIONS: Record<RoleType, RolePermissions> = {
  ADMIN: {
    role: "ADMIN",
    description: "Acesso total ao sistema, gerenciamento de chaves, cotas e servidores MCP",
    permissions: ["read:*", "write:*", "admin:*", "exec:*", "quarantine:*"],
  },
  DEVELOPER: {
    role: "DEVELOPER",
    description: "Criação de DAGs, execução de tarefas no terminal e proposição de skills",
    permissions: ["read:*", "write:code", "exec:terminal", "quarantine:stage", "proposal:create"],
  },
  AUDITOR: {
    role: "AUDITOR",
    description: "Leitura de logs de auditoria Dual-Lens, telemetria e revisões de código em quarentena",
    permissions: ["read:telemetry", "read:audit", "read:code", "read:revisions"],
  },
};

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req);
  if (authErr.response) return authErr.response;

  const roleParam = req.nextUrl.searchParams.get("role") as RoleType | null;

  if (roleParam && ROLE_DEFINITIONS[roleParam]) {
    return NextResponse.json({
      success: true,
      role: ROLE_DEFINITIONS[roleParam],
    });
  }

  return NextResponse.json({
    success: true,
    availableRoles: Object.values(ROLE_DEFINITIONS),
  });
}

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req);
  if (authErr.response) return authErr.response;

  try {
    const body = await req.json().catch(() => ({}));
    const role = (body.role || "DEVELOPER").toUpperCase() as RoleType;

    if (!ROLE_DEFINITIONS[role]) {
      return NextResponse.json(
        { success: false, error: `Papel '${role}' não reconhecido. Opções: ADMIN, DEVELOPER, AUDITOR` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      assignedRole: ROLE_DEFINITIONS[role],
      activePermissions: ROLE_DEFINITIONS[role].permissions,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Erro ao processar alteração de papel" },
      { status: 500 }
    );
  }
}
