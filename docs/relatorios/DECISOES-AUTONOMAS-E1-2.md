# Decisões autônomas — execução autônoma 2 (mudança 26, produção)

> O fundador delegou as decisões desta execução ("o que for para eu decidir, você vai decidir por mim"). Cada linha diz o que foi decidido, o que ficou de fora e por quê. Ordem: checklist P1–P13 da referência §5.0.

| # | Passo | Decisão | Alternativa descartada | Motivo / evidência |
|---|---|---|---|---|
| D1 | P1 | Máximo **8 ações por turno** | sem limite; 4 | 8 cobre o padrão medido (5,2 leituras antes da 1ª escrita, diário 162) + gravar + `run_check` num turno; sem limite, um modelo confuso pode disparar dezenas de leituras |
| D2 | P1 | Teto de **48.000 caracteres** de resultado por turno; leitura além disso volta "Não executada… peça de novo" | cortar o texto no meio | 4× o teto de uma ferramenta (12.000); corte no meio esconde linhas sem avisar. Gravações sempre executam (não devolvem texto grande) |
| D3 | P1 | `finish` só vale **sozinho**; misturado com outras ações, as outras rodam e o `finish` volta como "ignorado" | aceitar `finish` no fim da lista | o executor tem de ver o resultado do `run_check` antes de encerrar; aceitar faria entregar código que não compila |
| D4 | P1 | Lista no mesmo bloco **ou** vários blocos ` ```json acao ` somados | só lista | o DeepSeek já mandava vários blocos (erro "2 blocos" virava turno perdido); somar transforma esse erro em economia |
| D5 | P1 | Cada turno continua contando **1 passo** de `passos_max` (25) | contar cada ação | o limite existe para o custo, que é por chamada ao modelo; com várias ações por turno, o `[SKILL STEP LIMIT]` (estourou 3× no teste) fica mais longe |
| D6 | P2 | Contexto fixo = `tsconfig.json`, `prisma/schema.prisma` e os `lerContratos` do Microbrief que o bloco das dependências não trouxe; `package.json` não é repetido | ler o projeto inteiro; repetir o package.json | são os arquivos que o teste real releu (tsconfig 42×, schema 21×); o `package.json` já vem no contexto do projeto (`buildProjectContextBlock`) |
| D7 | P2 | Corte de **20.000 caracteres por arquivo** com aviso "use read_file para o resto"; **40.000 no total** | sem corte | o schema da Spec real é grande; sem corte, um arquivo come o prompt inteiro de todos os turnos |
| D8 | P2 | No bloco das dependências, arquivo que estoura o teto é **pulado** em vez de **parar a lista** | manter o `break` | com `break`, um arquivo grande escondia todos os menores depois dele — causa de leitura repetida |
| D9 | P2 | Contexto fixo só no modo laço | também na chamada única | a chamada única não tem `read_file`; nada a economizar |
| D10 | P3 | Código da tentativa reprovada guardado no `result` do nó (`codigoTentativa`), não numa tabela nova | quarentena mantida entre tentativas; tabela nova | o laço apaga a quarentena no início (`prepareWorkspace`); o `result` já é lido na retentativa para o feedback — sem migração de banco |
| D11 | P3 | **Nunca** guardar quando a guarda de segredos reprovou | guardar sempre | o código voltaria ao LLM com o segredo (regra 7 do fundador) |
| D12 | P3 | Código anterior vai **no prompt e já gravado na quarentena** | só no prompt | só no prompt, o modelo regrava o arquivo inteiro (custo de saída); na quarentena, `edit_file` corrige o trecho e os arquivos que estavam certos seguem para a promoção sem reescrita |
| D13 | P3 | Só arquivos ainda no escopo da etapa; teto de 60.000 caracteres (arquivo que estoura é pulado) | sem filtro | se o plano mudou, arquivo fora do escopo seria negado (T3) e gastaria turno |
