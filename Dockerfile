FROM node:20-alpine

# Instalação de utilitários de sistema necessários para compilação e suporte ao SQLite
RUN apk add --no-cache ca-certificates openssl sqlite

WORKDIR /app

# Copia dos arquivos de dependências
COPY package*.json ./
COPY prisma ./prisma/

# Instalação de dependências
RUN npm install

# Copia do código fonte restante
COPY . .

# Geração do Prisma Client para Alpine Node runtime
RUN npx prisma generate

# Exposição da porta da aplicação Next.js
EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME="0.0.0.0"
ENV NODE_ENV="development"

# Comando de desenvolvimento com suporte a Hot Reload
CMD ["npm", "run", "dev"]
