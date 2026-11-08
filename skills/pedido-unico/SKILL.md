---
name: pedido-unico
description: Conferente de pedido único antes do executor e de permanência da lacuna citada na tentativa seguinte.
papel: conferente
ferramentas: []
permissoes:
  escrever: nunca
  comandos: []
checagens:
  - retorno_do_contrato_e_criterio
  - lacuna_anterior_permanece
  - prova_carrega
---

# Conferente: Pedido Único e Mesma Lacuna

Esta skill governa a coerência do pedido da etapa antes de acionar o executor e a continuidade do julgamento entre tentativas consecutivas da mesma etapa.

## 1. Um pedido só (`retorno_do_contrato_e_criterio`)

Antes de gerar testes de aceite e antes de abrir o laço do executor, o porteiro compara o texto do contrato da etapa (`interfacesProduz`) com os critérios dos requisitos (`REQ`) atribuídos a ela:

- O tipo de retorno prometido no contrato e os campos exigidos pelos critérios devem formar um único pedido coerente.
- Se um critério pedir campos de saída que o tipo de retorno do contrato não nomeia (por exemplo, o contrato declara retorno `{ id: string }` enquanto o critério exige QR Pix, copia-e-cola ou linha digitável), a etapa falha fechada antes do executor.
- Quando há conflito, o porteiro não chama o executor, não consome tentativa, não bloqueia etapas dependentes em cascata e grava o conflito na etapa com uma única decisão para o humano: **"vale o contrato"** ou **"vale o critério"**.
- Sem essa escolha, a etapa não retorna à fila.
- **Vale o contrato:** o critério permanece registrado no histórico da etapa, mas sai do pedido ativo desta etapa; nem o teste de aceite nem a auditoria reprovam por campo ausente do retorno do contrato.
- **Vale o critério:** a etapa continua sem chamar o executor até que o texto do contrato guardado na sessão nomeie os campos exigidos; o alargamento do retorno é feito pelo harness no contrato da sessão somente após a escolha, sem editar arquivos do projeto alvo. O campo entra obrigatório, só na função que o critério nomeia. Status entre parênteses (por exemplo `VENCIDA`) não é campo. Campo opcional não conta como pedido cumprido.

## 2. A prova julga esse pedido (`prova_carrega`)

Os testes de aceite e a auditoria julgam estritamente o pedido vigente da etapa. A verificação de falha de carregamento de arquivo de teste (antes de qualquer asserção executar) aponta para `ownTestLoadFailure` em `src/core/governance/acceptance-tests.ts`, sem reimplementar essa regra.

## 3. A tentativa seguinte começa pela lacuna já citada (`lacuna_anterior_permanece`)

Quando a rejeição da tentativa anterior cita `arquivo:linha`, a tentativa seguinte começa por essa lacuna:

- Enquanto o código novo não mostrar que o trecho citado mudou, a nova rejeição repete obrigatoriamente a citação `arquivo:linha` anterior.
- Lacunas novas identificadas na tentativa atual podem ser acrescentadas ao parecer, mas não apagam a lacuna anterior que permaneceu no código.
- Auditorias consecutivas com listas diferentes de apontamentos não são tratadas como "já corrigido" se o trecho citado anteriormente continuar igual.
- O limite `maxAttempts` da etapa não é elevado. Quando o ciclo para por lacuna que permaneceu, o aviso nomeia a lacuna que permaneceu, mantém a Spec inalterada (sem pedir para dividir a Spec) e apresenta a ação **Re-tentar**.
