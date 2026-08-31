# Quiz

Express + MongoDB quiz application for Chemistry, Biology, and Physics study questions.

## Run locally

1. Install Node.js 22+ and MongoDB.
2. Copy `.env.example` to `.env` and adjust `MONGODB_URI` if needed.
3. Run `npm install`, then `npm start`.
4. Open <http://localhost:3000>.

To import source test-bank documents into MongoDB, place them in the source folders and run `npm run parse`. Those folders are intentionally ignored by Git because they are large source material; keep a backup outside the repository.

## Docker

`docker compose up -d --build` starts both the app and MongoDB. The web app is available on port 3000.

## Oracle Cloud Compute deployment

Use an Ubuntu OCI Compute VM, install Docker, clone this repository, and run:

```sh
cp .env.example .env
docker compose up -d --build
```

Allow TCP port 3000 in the OCI security list (or put Nginx/HTTPS in front of it). For production, use a managed MongoDB URI instead of exposing MongoDB publicly.

