// Uso: tsx rodar.mjs <pasta-do-projeto-gerado> <p1|p2|p3|p4>
// Saída: uma linha JSON por teste e uma linha "RESUMO {...}".
import { criarRegistro } from "./comum.mjs";
import { testarApiTarefas } from "./api-tarefas.mjs";
import { testarTelaTarefas } from "./tela-tarefas.mjs";
import { testarAuth } from "./auth.mjs";
import { testarCorrecaoTarefas } from "./correcao-tarefas.mjs";

const [root, projeto] = process.argv.slice(2);
if (!root || !["p1", "p2", "p3", "p4"].includes(projeto)) {
  console.error("uso: rodar.mjs <pasta> <p1|p2|p3|p4>");
  process.exit(2);
}

const r = criarRegistro();
if (projeto === "p1" || projeto === "p2") await testarApiTarefas(root, r);
if (projeto === "p2") await testarTelaTarefas(root, r);
if (projeto === "p3") await testarAuth(root, r);
if (projeto === "p4") await testarCorrecaoTarefas(root, r);

for (const x of r.resultados) console.log(JSON.stringify(x));
const aprovados = r.resultados.filter((x) => x.ok).length;
console.log(
  `RESUMO ${JSON.stringify({ projeto, total: r.resultados.length, aprovados, reprovados: r.resultados.length - aprovados })}`
);
