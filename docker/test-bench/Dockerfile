# Bancada de testes do NextCode (mudança 43): roda testes vitest do projeto gerado DENTRO deste contêiner.
# Duas chamadas: "install" (com rede) prepara node_modules num volume de cache; "run" (SEM rede, projeto
# só leitura) executa os testes e grava o resultado em JSON. O código gerado pela IA nunca roda na máquina.
# Mesma base da verificação de tela (já baixada); a camada é só os scripts.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /opt/test-bench
COPY --chown=pwuser:pwuser install.sh run.sh vitest.config.mjs ./
# /deps é o ponto do volume de cache: criado aqui com dono pwuser, o volume novo herda o dono.
RUN chmod +x install.sh run.sh && mkdir -p /deps && chown pwuser:pwuser /deps

USER pwuser
ENTRYPOINT ["/bin/bash"]
