# O que foi implementado — execução autônoma 5 (mudança 44), 22/10/2026

Linguagem simples, para o fundador. As decisões que tomei por você estão em `DECISOES-AUTONOMAS-E5.md`; a auditoria técnica (commits, testes, provas) em `AUDITORIA-E5.md`.

## Veredito
O NextCode passou a **decidir pela prova**:
- um defeito só reprova a entrega se um teste que roda mostrar o problema;
- o que já foi provado continua sendo conferido em toda rodada;
- cada conserto é protegido contra quebrar o que já funcionava.

A Spec ficou mais completa: documentação oficial das APIs, origem de cada requisito, regras obrigatórias por tipo de projeto, correção por trecho. Cada etapa ganhou **testes escritos antes do código**, por um papel que não vê o código.

## 1. Entrega e reparo (o pedido "resultado melhor, sem rigidez")
- **O reparo alcança o arquivo certo.** Se o defeito está em dois arquivos, a etapa de reparo pode editar os dois. Antes, ela ficava presa: o teste exigia o conserto num arquivo que ela não podia mexer.
- **Só reprova com prova.** O que é só opinião da leitura (ex.: tela) acompanha o reparo e, se for tudo o que sobrou, a entrega sai com **ressalvas listadas no chat**. Antes não havia mensagem de entrega.
- **O provado não some.** A cada verificação, todos os testes que já provaram defeitos rodam de novo, sem depender da leitura do revisor. Foi assim que o bug do cabeçalho `asaas-access-token` do Gateway deixou de passar escondido.
- **O consertado não quebra de novo.** Cada etapa de reparo roda, antes de ser aceita, as provas antigas e os testes do projeto que tocam os seus arquivos.
- **Teste errado não trava.** A bancada isola os mocks entre os casos de teste; o contrato que travava uma etapa do Gateway era um teste mal escrito.

## 2. Spec (E2)
- **Documentação oficial (T7):** quando a conversa cita um serviço (Asaas, Stripe, Resend…), o NextCode busca a documentação oficial, passa por uma trava de segurança e entrega ao elicitador. Só o nome do serviço sai da máquina.
- **Origem de cada requisito (J11):** todo REQ diz de que frase sua ele veio. O que não veio do seu pedido aparece na revisão para você confirmar.
- **Regras obrigatórias (J8):** projeto com pagamento, login, vários clientes, mensagens ou API pública é conferido item a item (centavos, webhook único, estorno, senha com hash, isolamento entre clientes…). O que faltar vira pergunta para você.
- **Perfil (J7):** com quem não é técnico, o elicitador fala sem jargão e pergunta pelo comportamento.
- **Correção por trecho:** ajustar uma linha da Spec não reescreve a Spec inteira. O modelo devolve só o que muda e o código aplica.

## 3. Autoteste (E5)
- Um papel novo, o **testador**, escreve os testes de cada etapa **antes** do código, só pelo que o Microbrief pede.
- Teste que já passa sem código não prova nada e é descartado. Em etapa que corrige algo existente, ele vira teste de "não quebrar".
- Parte dos testes fica **escondida**: o executor não vê, só o portão roda. Assim ele não programa para o teste.

## 4. Jev revisado (JV1)
- Saíram dois usos que não mudavam nada ou mudariam para pior. A evidência por REQ teria dado 15 reprovações erradas; a auditoria final nunca coube.
- O planejamento (nível de modelo por etapa) voltou a funcionar em projeto grande.
- A tabela completa está em `JV1-revisao-jev.md`.

## 5. Outras melhorias
- **Fechar projeto:** a execução para; ao reabrir, o chat diz onde você parou e continua.
- **Skills batem com o código:** o elicitador foi reescrito; protocolo duplicado removido; papel de skill desconhecido não vira mais "executor" calado.
- **Segurança:** instrução plantada em arquivo do projeto chega ao executor marcada como dado (J20); OmniRoute só em loopback; imagens Docker com versão fixa; CI pronto (não publicado).
- **Testes estáveis:** a suíte falhava às vezes porque testes mexiam na sessão um do outro. Corrigido na causa.

## 6. Gateway (seu projeto real)
Rodadas 4 a 7 de reparo. Os defeitos **provados** por revisão caíram de 8 para 5, e nada que foi consertado voltou a quebrar depois da proteção de regressão.

- Rodadas 4–7, autorizadas por mim: os contratos das últimas duas passaram 100%.
- O Gateway **ainda não foi entregue**. Está bloqueado com 5 defeitos provados (papéis de usuário, painel admin, comprovante enviado 2×).
- Continua quando houver crédito na Anthropic: o avaliador e a revisão final usam o Claude, e o crédito acabou às ~20:23 UTC de 22/10.
- Custo da sessão até aqui: US$ 37,07.

## 7. Medição com e sem Jev (J4) e teste final

| Projeto | Com Jev | Sem Jev |
|---|---|---|
| P1 | entregue, 10/10, US$ 0,115 | entregue, 10/10, US$ 0,146 |
| P2 | entregue, 13/13, US$ 0,23–0,26 | entregue, 13/13, US$ 0,56 (precisou de uma rodada de reparo) |
| P3 / P4 | inconclusivo | inconclusivo |

**Com Jev, o mesmo resultado sai mais barato** (P1 −21%, P2 −55%), porque ele escolhe o modelo certo por etapa.

O P3 revelou dois problemas, ambos corrigidos:
- um teste de aceite exigiu cookies que a Spec não pede, e o código passou a não carregar fora do Next;
- a revisão final não rodou por falta de crédito e a entrega saiu sem conferência. Agora isso **bloqueia** com o motivo e o botão Retomar.

P3 e P4 precisam rodar de novo com crédito para fechar a medição.

## 8. Dependências
- **Produção:** 0 vulnerabilidades (eram 3 críticas, inclusive no Next.js). O build de produção passa.
- **Desenvolvimento:** sobram 13, que exigem trocar o executor de testes (vitest 5) e o CSS (tailwind 4). Ficaram para uma mudança própria.
