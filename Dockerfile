FROM denoland/deno:alpine-2.7.9

ENV TINI_SUBREAPER=true

EXPOSE 8000
WORKDIR /app
USER deno

ADD . .

CMD ["run", "--allow-env", "--env-file", "--allow-net", "--unstable-cron", "--unstable-kv", "--allow-read", "main.ts"]
