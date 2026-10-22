# Decisões que o Claude tomou pelo fundador — execução autônoma 5 (mudança 44)

**Delegação (22/10/2026):** "não quero que ajuste para passar os testes, eu quero ajustes para termos um resultado melhor, se está muito rígido vamos ver se podemos ajustar… continue com a implementação e pode escolher e tomar decisões por mim… pensar de forma macro… implemente tudo e ao final emita dois relatórios".

Regra que segui em todas: **decidir com dado medido**; quando a decisão afrouxa uma trava, a prova (teste que roda) continua mandando; nada que tire segredo da máquina; nada publicado para fora (sem `push`).

## A. Entrega e reparo — "resultado melhor, sem rigidez"

| # | Decisão | Por quê (dado) | Onde |
|---|---|---|---|
| E5-D1 | O escopo da etapa de reparo inclui **todos os arquivos de código citados no defeito**; Re-tentar recalcula | Gateway rodada 4: o segredo fixo estava em `auth.ts` e `middleware.ts`; a etapa só podia editar o primeiro e o contrato falhou 3× | 44.1 `1f5234f` |
| E5-D2 | **Só reprova o que tem prova**: teste que falha, `critico`, ou bancada fora (sem como provar = comportamento antigo). Defeito só de leitura acompanha o reparo; sozinho, vira **ressalva** na mensagem de entrega | 10 revisões seguidas achando "parciais" diferentes só pela leitura — a entrega nunca fecharia sem critério de prova | 44.2 `44a5b2e` |
| E5-D3 | Mensagem de entrega no chat (o que foi conferido, ressalvas, perguntas) | não existia mensagem nenhuma ao entregar | 44.2 |
| E5-D4 | Problema "importante" **vai à bancada** como os outros: teste falha → defeito; passa → sai; sem teste → ressalva | a rodada 5 entregou o REQ-018 aberto porque a leitura trocou o rótulo de "parcial" para "importante" | 44.2b/c `0698c78` `4971077` |
| E5-D5 | **Todo teste que já provou um defeito roda de novo** em cada verificação final; e cada etapa de reparo roda, no portão, as provas anteriores e os testes do projeto do seu escopo (**regressão**) | leitura varia, teste não; rodada 6 consertou 6 defeitos e quebrou 2 da rodada 5 sem saber | 44.2c/d/e `4971077` `2f17e4d` `39f790c` |
| E5-D6 | Bancada fora (Docker parado) **reprova** como antes | sem isso, tudo viraria ressalva e a entrega passaria sem teste nenhum | 44.2c |
| E5-D7 | Bancada com `clearMocks` (imagem `:2`) | contrato do Gateway contava no 2º caso a chamada do 1º e travava a etapa — o executor não pode mexer no teste | 44.9 `151a35f` |
| E5-D8 | Rodadas extras 5, 6 e 7 do Gateway autorizadas por mim; critério de parada: parar se os defeitos **provados** não caírem por 2 rodadas | placar de provados 7 → 6 → 5 (caindo); custo ~US$ 1,5–3,8 por rodada | trilha `REPAIR_ROUND_AUTHORIZED` |

## B. Jev — "usar ao máximo, com prova"

| # | Decisão | Por quê (dado) |
|---|---|---|
| E5-D9 | **J23 (evidência) desligado** | 211 checagens, 15 divergências — todas em REQ que a bancada provou implementados; ativo daria 15 reprovações indevidas |
| E5-D10 | **J2 (auditoria final do Jev) desligado** | o estado (284 mil caracteres) nunca coube nos 28 mil do Jev; a revisão final com bancada faz o papel |
| E5-D11 | **M3 em lotes** de até 8 Microbriefs | o plano do Gateway estourava o estado e as 40 etapas caíam no nível de reserva |
| E5-D12 | A3 (roteamento por diagnóstico) **continua em sombra**; diagnóstico continua ativo (só dica) | no único caso conferido o Jev disse `wrong_code` para um defeito do plano (escopo) |
| E5-D13 | J11 (origem de cada REQ) **mecânico**, não pergunta ao Jev; avisa, não bloqueia | determinístico, de graça, e não manda a conversa para fora (§6 item 3) |
| E5-D14 | J8 (lacunas obrigatórias): palavra-chave → Jev em lote → **aviso ao usuário**, sem 2ª chamada escondida ao Opus | a SM1 já tinha condenado a chamada escondida (US$ 0,47); a aprovação é do humano (T2). Medido: Gateway 10/10 coberto; P3 acusava papéis num login simples → regra ajustada |
| E5-D15 | J7: o perfil que o Jev já calculava passa a guiar o elicitador; **J9 não criado** | J7 não tinha dono da resposta; J9 não tem o que escolher (uma stack, nenhuma skill de domínio) |
| E5-D16 | Esforço (`effort`) da Anthropic **mantido no padrão** | controles: medium e low acertam igual (efeito teto); economia de centavos no último portão de qualidade |

## C. Entrada (E2)

| # | Decisão | Por quê |
|---|---|---|
| E5-D17 | §6 item 5 (busca da T7): **buscador aberto sem conta** (DuckDuckGo HTML, já no código) + domínio oficial por serviço + **páginas verificadas ao vivo** como reserva; Exa fica como opção se você criar conta | Exa exige conta (não crio contas); o buscador aberto limita rajadas — a reserva cobre |
| E5-D18 | Limiar de injeção da T7: **0,15 → 0,80** | medido no Jev real: páginas oficiais do Asaas 0,34–0,47; injeção plantada 0,94–0,98 (0,15 recusava toda documentação) |
| E5-D19 | Correção da Spec **por trecho** como padrão, com a reescrita inteira de reserva; âncora errada = nada aplicado + motivo | mudança 7 aprovada em 16/10; custo de US$ 0,47 por correção de uma linha |

## D. Autoteste (E5)

| # | Decisão | Por quê |
|---|---|---|
| E5-D20 | §6 item 6: **sim**, testes visíveis + escondidos (com 2+ testes do mesmo REQ, o último fica escondido) | recomendação já registrada; o executor não "decora" |
| E5-D21 | §6 item 7, **ajustado com dado**: teste de aceite falhando = nova tentativa; na **última**, com o avaliador aprovando, a etapa **segue com ressalva** (`ACCEPTANCE_DISAGREEMENT`) e a revisão final reproduz a suspeita | teste cego errou o REQ-003 do P4 em 1 de 2 rodadas antes da regra 5 da skill; travar por teste errado seria a rigidez que você pediu para tirar |
| E5-D22 | Teste do teste por tipo de etapa: cria → teste que já passa sai; modifica → vira regressão | controle P4: o teste certo de "continua funcionando" passa antes |
| E5-D23 | Testador = Claude Sonnet 5.5 (Opus de reserva), skill própria | outra família do executor (T4); mesma cadeia do revisor |

## E. Qualidade do código e operação

| # | Decisão | Por quê |
|---|---|---|
| E5-D24 | Elicitador reescrito; `project-memory` sai de `skills/` (não era skill); **papel de skill desconhecido falha fechado** | antes virava "executor" calado, com escrita no escopo |
| E5-D25 | Código morto M1/M4 **removido** | "fora da ordem" aguardava decisão; sem chamador (`git grep`) |
| E5-D26 | Fechar projeto = arquivar com a fila parada (sem mudar o schema) | "onde parou" já está gravado na fase e nas etapas |
| E5-D27 | CI criado **e não publicado** (sem `push`) | publicar é ação externa: fica com você |
| E5-D28 | Imagens fixadas por digest; OmniRoute só em loopback | `:latest` muda sozinho; a porta 20128 estava aberta em todas as interfaces |
| E5-D29 | Testes isolados por sessão (`onlySessionIds`) | a suíte falhava às vezes porque supervisores de um arquivo retomavam a sessão de outro |
| E5-D30 | §6 item 3 (privacidade do Jev): **aceito para o seu NextCode**, como proposto; as peças novas evitam mandar conversa (J11 mecânico, T7 manda só o nome do serviço) | rever antes de outros usuários |
| E5-D31 | §6 item 4 (stack do Gateway): **Next.js**, já provado no Gateway real | — |
