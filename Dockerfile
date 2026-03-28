FROM denoland/deno:alpine-2.7.9

# ENV TINI_SUBREAPER=true

EXPOSE 5000
WORKDIR /app
USER deno

ADD . .

CMD ["run", "--allow-net", "--allow-read", "main.ts"]
