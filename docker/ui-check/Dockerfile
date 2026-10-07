# Verificação de tela do NextCode (cluster frontend): roda o projeto gerado DENTRO deste contêiner e
# abre as páginas num navegador real (Chromium), em celular e desktop. O código gerado pela IA só é
# executado aqui dentro — nunca na máquina do usuário.
# Imagem oficial da Microsoft com Node e os navegadores; a biblioteca precisa ter a MESMA versão.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /opt/ui-check
RUN npm init -y >/dev/null && npm install --omit=dev playwright@1.63.0 && chown -R pwuser:pwuser /opt/ui-check
COPY --chown=pwuser:pwuser check.mjs run.sh ./
RUN chmod +x run.sh

# Usuário sem privilégios (já existe na imagem oficial).
USER pwuser
ENTRYPOINT ["/opt/ui-check/run.sh"]
