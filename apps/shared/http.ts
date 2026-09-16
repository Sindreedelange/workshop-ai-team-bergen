// The HTTP plumbing every service repeats: CORS, JSON and text responses, and
// reading a request body.
//
// This lived in apps/sandbox-backend/src/http.ts and was copied by hand into five
// other services. The copies drifted - four different Allow-Headers values, two
// services that leave CORS off text responses, and one that sets Cache-Control.
// Nothing caught it, because scripts/kontrakt-smoke.js records status and body but
// not response headers.
//
// So the policy is a parameter rather than a constant: every difference is now
// visible on the one line where a service configures itself, instead of buried in
// its own copy of the same twenty lines.

import type { IncomingMessage, ServerResponse } from "node:http";
import { formaterHendelse } from "./hendelsesstroem.ts";

/**
 * Authorization must be in Allow-Headers: demo-gui calls these services
 * cross-origin from :3001, and the moment it sends a bearer token the request
 * becomes preflighted. Without it every browser call fails in preflight, visible
 * only in the console, while curl keeps working perfectly.
 */
export function cors(
  methods = "GET,POST,PUT,OPTIONS",
  headers = "Content-Type,Authorization"
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": headers
  };
}

/**
 * Om kallet kommer fra tjenestens egen side, eller fra noe som ikke er en nettleser.
 * Uten Origin er det curl eller et skript, og de slipper fri. «null» avvises.
 *
 * Hører her fordi cors() over setter Allow-Origin: *. Den åpenheten er med vilje -
 * deltakere bygger egne frontender - men den gjør at enhver nettside i deltakerens
 * nettleser kan poste hit. Ruter som koster penger eller bærer et maskintoken kan
 * kalle denne; resten skal fortsatt stå åpne.
 */
export function sammeOpphav(request: IncomingMessage): boolean {
  const opphav = request.headers.origin;
  if (!opphav) return true;
  return URL.parse(opphav)?.host === request.headers.host;
}

export type Svarpolicy = {
  /** Headers on every response. Defaults to `cors()`. */
  cors?: Record<string, string>;
  /** Extra headers on JSON responses only - digdir-mock needs Cache-Control. */
  jsonHeaders?: Record<string, string>;
  /** Headers on text and HTML responses. Defaults to the same as `cors`. */
  tekstCors?: Record<string, string>;
};

/**
 * En åpen strøm av hendelser til nettleseren.
 *
 * `send` skriver én hendelse, `avslutt` lukker forbindelsen. Kalleren må alltid
 * kalle `avslutt`, også når noe feiler - en strøm som aldri lukkes lar siden stå
 * og vente uten at noe skjer.
 */
export type Hendelsesstroem = {
  send(hendelse: string, data: unknown): void;
  avslutt(): void;
};

export type Svarhjelpere = {
  jsonResponse(
    response: ServerResponse,
    statusCode: number,
    data: unknown,
    headers?: Record<string, string>
  ): void;
  textResponse(
    response: ServerResponse,
    statusCode: number,
    data: string,
    contentType?: string
  ): void;
  /**
   * Åpner en `text/event-stream` og lar svaret stå åpent.
   *
   * De to andre hjelperne avslutter svaret med `response.end` med en gang. Denne
   * gjør ikke det, og det er hele poenget: innbyggeren skal se hvilken kilde som
   * hentes mens den hentes, ikke få hele listen etterpå.
   *
   * `X-Accel-Buffering: no` står der fordi en mellomliggende proxy ellers kan
   * samle opp hendelsene og levere dem i én bolk - da er strømmen teknisk riktig
   * og praktisk verdiløs.
   */
  hendelsesstroem(response: ServerResponse): Hendelsesstroem;
};

export function svarhjelpere(policy: Svarpolicy = {}): Svarhjelpere {
  const felles = policy.cors ?? cors();
  const tekstHeadere = policy.tekstCors ?? felles;
  const jsonHeadere = { ...felles, ...policy.jsonHeaders };

  return {
    jsonResponse(response, statusCode, data, headers = {}) {
      response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        ...jsonHeadere,
        ...headers
      });
      response.end(JSON.stringify(data, null, 2));
    },

    textResponse(response, statusCode, data, contentType = "text/html; charset=utf-8") {
      response.writeHead(statusCode, { "Content-Type": contentType, ...tekstHeadere });
      response.end(data);
    },

    hendelsesstroem(response) {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...tekstHeadere
      });
      return {
        send(hendelse, data) {
          if (response.writableEnded) return;
          response.write(formaterHendelse(hendelse, data));
        },
        avslutt() {
          if (!response.writableEnded) response.end();
        }
      };
    }
  };
}

/**
 * Returns `unknown`, not `any`: this is JSON off the wire and nothing has checked
 * its shape. Callers name the shape they expect with a cast at the call site, so
 * the assumption is written down where it is made rather than hidden here.
 *
 * An empty body yields `{}` - routes that take no arguments call this too.
 */
export async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
