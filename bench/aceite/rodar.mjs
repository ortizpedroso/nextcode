// Uso: tsx rodar.mjs <pasta-do-projeto-gerado> <p1|p2>
// Saída: uma linha JSON por teste e uma linha "RESUMO {...}".
import { criarRegistro } from "./comum.mjs";
import { testarApiTarefas } from "./api-tarefas.mjs";
import { testarTelaTarefas } from "./tela-tarefas.mjs";

const [root, projeto] = process.argv.slice(2);
if (!root || !["p1", "p2"].includes(projeto)) {
  console.error("uso: rodar.mjs <pasta> <p1|p2>");
  process.exit(2);
}

const r = criarRegistro();
await testarApiTarefas(root, r);
if (projeto === "p2") await testarTelaTarefas(root, r);

for (const x of r.resultados) console.log(JSON.stringify(x));
const aprovados = r.resultados.filter((x) => x.ok).length;
console.log(
  `RESUMO ${JSON.stringify({ projeto, total: r.resultados.length, aprovados, reprovados: r.resultados.length - aprovados })}`
);
