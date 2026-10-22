# Isolated execution environment for the agent's bash / file tools.
# One container per conversation is created from this image by @minibot/sandbox.
FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     bash coreutils util-linux procps findutils grep sed gawk less file tree \
     ripgrep fd-find git curl wget ca-certificates jq unzip xz-utils \
     python3 python3-pip python3-venv \
  && ln -s /usr/bin/fdfind /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*

# Unprivileged user; uid 1000 matches the ownership used when writing files via the archive API.
RUN groupadd --gid 1000 agent \
  && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash agent \
  && mkdir -p /workspace && chown agent:agent /workspace

USER agent
WORKDIR /workspace
ENV HOME=/home/agent LANG=C.UTF-8

CMD ["sleep", "infinity"]
