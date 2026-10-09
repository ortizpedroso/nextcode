# Contêiner de Testes de Aceite Sem Rede (`nextcode-aceite:1`)

Ambiente hermético e isolado para execução da suíte de testes de aceite (`bench/aceite/`) contra projetos gerados pela orquestração do NextCode.

O código gerado por IA **nunca roda no host**; roda apenas dentro deste contêiner com privilégios reduzidos e **sem acesso à rede**.

## Construção da Imagem

```bash
docker build -t nextcode-aceite:1 docker/aceite
```

## Execução

```bash
docker run --rm --network none --memory=1g --cpus=1 --pids-limit=256 --cap-drop=ALL --security-opt=no-new-privileges -v <projeto>:/project:ro -v <repo>/bench/aceite:/aceite:ro nextcode-aceite:1 p1
```

Onde:
- `<projeto>`: caminho absoluto para a pasta do projeto gerado (montado em `/project:ro`).
- `<repo>/bench/aceite`: caminho absoluto para o diretório dos testes de aceite (montado em `/aceite:ro`).
- `p1`, `p2`, `p3` ou `p4`: identificador do projeto/cenário a testar.
