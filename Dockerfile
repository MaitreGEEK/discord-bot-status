# Étape 1 : Utiliser une image de base pour Bun
FROM oven/bun:latest

# Étape 2 : Créer un répertoire de travail
WORKDIR /app

RUN apt-get update && apt-get install git

# Étape 3 : Télécharger le projet depuis GitHub en utilisant le token
RUN git clone https://github.com/MaitreGEEK/discord-bot-status.git .

# Étape 4 : Installer les dépendances
RUN bun install

ENV API_PORT=6070
ENV API_URL=
ENV DATABASE_PATH=
ENV TOKEN=
ENV RESPONSE_PERIOD=

# Étape 5 : Exposer le port configuré par l'environnement
EXPOSE ${API_PORT:-6070}

# Étape 6 : Définir la commande d'entrée pour démarrer l'application
CMD bun run app.js