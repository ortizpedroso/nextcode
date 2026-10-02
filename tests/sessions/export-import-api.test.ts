import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/sessions/export-import/route";
import { NextRequest } from "next/server";

describe("API /api/sessions/export-import", () => {
  let testSessionId: string;

  beforeEach(async () => {
    // Clear test database
    await prisma.sessionMessage.deleteMany({});
    await prisma.taskNode.deleteMany({});
    await prisma.session.deleteMany({});

    const session = await prisma.session.create({
      data: {
        title: "Test Export Session",
        canonicalSpec: "# Spec Test",
        specApproved: true,
        tasks: {
          create: [
            {
              title: "Task 1",
              role: "architect",
              status: "completed",
              dependencies: "[]",
            },
          ],
        },
        messages: {
          create: [
            {
              role: "user",
              content: "Hello NextCode",
            },
          ],
        },
      },
    });

    testSessionId = session.id;
  });

  it("GET — exports session JSON backup correctly", async () => {
    const req = new NextRequest(`http://localhost/api/sessions/export-import?sessionId=${testSessionId}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.version).toBe("5.0");
    expect(data.session.title).toBe("Test Export Session");
    expect(data.tasks.length).toBe(1);
    expect(data.messages.length).toBe(1);
  });

  it("POST — restores session from JSON backup", async () => {
    const backupData = {
      version: "5.0",
      session: {
        title: "Restored Session",
        canonicalSpec: "# Restored Spec",
        specApproved: true,
      },
      tasks: [
        {
          title: "Restored Task 1",
          role: "developer",
          status: "pending",
          dependencies: "[]",
        },
      ],
      messages: [
        {
          role: "user",
          content: "Import test message",
        },
      ],
    };

    const req = new NextRequest("http://localhost/api/sessions/export-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backup: backupData }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.session.id).toBeDefined();

    // Verify DB insertion
    const restoredTasks = await prisma.taskNode.findMany({
      where: { sessionId: data.session.id },
    });
    expect(restoredTasks.length).toBe(1);
    expect(restoredTasks[0].title).toBe("Restored Task 1");
  });
});
