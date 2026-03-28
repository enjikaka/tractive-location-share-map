FROM denoland/deno:alpine-2.7.9

ENV TINI_SUBREAPER=true

EXPOSE 8000
WORKDIR /app
USER deno

ADD . .

CMD ["run", "--unstable-kv" , "--allow-net", "--allow-read", "--allow-env", "main.ts"]
