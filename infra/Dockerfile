# One image, three services (bridge, simulator, fixture-store), chosen by SERVICE at run time.
# Built in AWS (CodeBuild) and run on App Runner; no Docker needed on a developer machine.
FROM public.ecr.aws/docker/library/node:24-slim

WORKDIR /app
ENV CI=true
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

# Dependencies first, for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/agents/package.json packages/agents/
COPY packages/bridge/package.json packages/bridge/
COPY packages/fixture-store/package.json packages/fixture-store/
COPY packages/store-client/package.json packages/store-client/
COPY apps/simulator/package.json apps/simulator/
RUN pnpm install --frozen-lockfile

COPY . .
# The MCP Apps views are committed; only the simulator's web app is built here.
RUN pnpm --filter @agentpos-alexa/simulator build:web

# No secrets in the image: AWS access comes from the App Runner instance role, the rest
# from the service's environment. SQLite lives on the instance's ephemeral disk.
ENV NODE_ENV=production \
    SERVICE=bridge \
    PORT=8080
EXPOSE 8080
USER node
CMD ["sh", "infra/entrypoint.sh"]
