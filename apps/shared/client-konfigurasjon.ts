export function buildClientKonfigurasjon(env: NodeJS.ProcessEnv = process.env) {
  return {
    backendBaseUrl: env.BACKEND_PUBLIC_URL || env.TILTAKSHJELPEN_BACKEND_PUBLIC_URL || env.GARASJE_BACKEND_PUBLIC_URL || "http://localhost:8080",
    idportenBaseUrl: env.IDPORTEN_PUBLIC_URL || env.TILTAKSHJELPEN_IDPORTEN_PUBLIC_URL || env.GARASJE_IDPORTEN_PUBLIC_URL || "http://localhost:8086",
    aiBaseUrl: env.AI_PUBLIC_URL || "http://localhost:8082",
    agentBaseUrl: env.AGENT_PUBLIC_URL || "http://localhost:8084",
    toolsBaseUrl: env.TOOLS_PUBLIC_URL || "http://localhost:8083",
    fiksBaseUrl: env.FIKS_PUBLIC_URL || "http://localhost:8081",
    matrikkelBaseUrl: env.MATRIKKEL_PUBLIC_URL || "http://localhost:8085",
    pasientjournalBaseUrl: env.PASIENTJOURNAL_PUBLIC_URL || "http://localhost:8087",
    politiattestBaseUrl: env.POLITIATTEST_PUBLIC_URL || "http://localhost:8088"
  };
}
