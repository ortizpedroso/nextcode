# O que foi implementado — Execução autônoma 4 (21–22/10/2026)

**Resumo:** fechei a E1. O NextCode agora:
- reconhece quando o problema é a máquina, e não o código;
- diz no aviso o que fazer em cada caso;
- conserta sozinho uma entrega reprovada (até 3 rodadas);
- tem uma revisão final que lê o projeto inteiro antes de entregar.

O teste real do Gateway saiu de BLOQUEADA e chegou a **ENTREGUE**: 3 reparos automáticos, todos aprovados na 1ª tentativa, por US$ 0,24.

**Atenção:** a revisão final, rodada depois no Gateway entregue, achou **15 requisitos incompletos**. O mais grave: com a chave própria do Asaas, toda cobrança falha. Ou seja, o Gateway foi entregue pelas regras antigas, mas **não está pronto para uso**. O que fazer está no fim.

Detalhe técnico, commits e provas: `AUDITORIA-E1-4.md`. Decisões que tomei por você: `DECISOES-AUTONOMAS-E1-4.md`. Prompt para outro LLM testar: `docs/prompts/TESTE-E1-4.md`.

## O que mudou para você

| # | Antes | Agora |
|---|---|---|
| **35** Falha de ambiente | Sem memória para rodar a conferência de tipos, o NextCode dizia "0 erros, reprovado" | Diz "o type-check não rodou (falta de memória?), não é erro de código" e para com **Retomar** |
| **36** Aviso de bloqueio | Sempre "responda o que ajustar, a Spec volta para revisão", mesmo quando faltava memória | O aviso diz o que fazer conforme a causa: **Retomar**, **Autorizar verba**, **Re-tentar** a etapa ou ajustar a Spec |
| **36** Botão Retomar | Não existia quando nenhuma etapa estava bloqueada | Botão **Retomar** no Monitor da DAG, ou escrever `retomar` no chat |
| **G1** Leitor de ação do executor | Recusava a ação certa por detalhe de formato (49 vezes no Gateway) | Aceita as variações reais; dos turnos recusados que a trilha guarda inteiros, 9 de 9 passam |
| **G2** Resposta do avaliador descartada | Sumia sem motivo na trilha | O motivo fica na trilha e vai junto na 2ª tentativa |
| **G3** Relatório de incidente | Culpava uma etapa que só estava esperando outra | Aponta a etapa que falhou de verdade |
| **J2b** Entrega reprovada | Ia direto para BLOQUEADA | Cada erro é ligado à etapa dona do arquivo, e ela é refeita a partir do código atual. Até 3 rodadas; depois para e avisa com o histórico |
| **J2.7** Teste da máquina de fases | Usava listas escritas à mão, com nomes inventados | Usa as listas do próprio código; faltou um evento, não compila |
| **J3** Revisão final | Não existia | Lê a Spec inteira e todos os arquivos, sem ver relatório de ninguém, e julga cada requisito com `arquivo:linha`. O que reprovar vira reparo. Sonnet 5.5 (o Opus acertou igual e custa o dobro) |
| **TS1** Testes lentos | 2 arquivos com prazo aumentado | Prazo padrão; a suíte passou 2× |
| Teto de custo | US$ 80 temporário | De volta a US$ 0,50 (o teto calculado pelo plano já cobre o Gateway) |

## Como o teste real terminou

1. Com memória livre, a conferência rodou de verdade. Dos 71 erros de ontem sobraram **9 reais**, em 3 arquivos (registro, e-mail, middleware).
2. O reparo automático abriu **3 etapas**. O Docker estava parado, então a sessão **pausou sem gastar nenhuma tentativa**. Liguei o Docker e ela voltou sozinha.
3. As 3 etapas foram **aprovadas na 1ª tentativa**, com 4 a 6 ações cada, e o projeto passou a compilar com **0 erros**.
4. A revisão final deveria ter rodado aqui, mas **não rodou**: um defeito meu deixou pouco espaço de resposta. A sessão foi para ENTREGUE.
5. Corrigi a revisão final e rodei no projeto entregue. **50 requisitos completos e 15 parciais**, por US$ 0,68.

## Os 15 problemas que a revisão final achou no Gateway

- Chave própria do Asaas: não grava a subconta, e toda cobrança falha.
- Webhook do Asaas: lê o cabeçalho errado, deixa o status voltar (PAGA → VENCIDA) e reenvia o comprovante.
- Taxas: não aceitam percentual quebrado (2,99%) e o cálculo ignora campos da configuração.
- Link de valor livre: quebra no checkout.
- WhatsApp: o comprovante usa o campo de telefone errado.
- A API expõe a URL do provedor, o que a Spec proíbe.
- Cobrança é aceita sem e-mail e sem WhatsApp do pagador.
- Papel do usuário diferente da Spec; e-mail de suporte do whitelabel não usado; serializador lendo campos que não existem; um teste que espera um erro que o código não dá.
- Enum com `CARTAO` e `CARTAO_CREDITO` duplicados. **Esse vem em parte de mim:** completei o schema em 21/10 e acrescentei `CARTAO`.

## O que você precisa decidir

1. **Consertar o Gateway.** Recomendo um passo pequeno novo: "reabrir a entrega pela revisão final", que manda esses 15 defeitos para o reparo automático (estimo US$ 1 a 3). A alternativa é pedir a correção no chat, o que gera uma Spec nova e refaz o plano (mais caro). Não fiz sozinho porque mexe no seu projeto real.
2. **J4** (perguntas do Jev na revisão final e medição com × sem Jev): é o próximo da fila.
3. Pendências antigas: privacidade do Jev, busca oficial (Exa) e os 2 pontos do autoteste.

## Gasto desta execução

| Item | Custo |
|---|---|
| Retomada do Gateway (3 reparos) | US$ 0,24 |
| Controles da revisão final (Opus e Sonnet) | US$ 0,45 |
| Revisão final no Gateway (2 rodadas) | US$ 1,69 |
| Chamadas sem texto na retomada (não registradas, estimado) | ~US$ 0,76 |
| **Total** | **~US$ 3,14** |
