// The eval as the command in run.ts's header runs it, with its real I/O but OpenRouter replaced
// by a fake fetch: one usable model, and one vocabulary card at $0.001 a call. run_io_test.ts
// runs it as a subprocess.
import { OPENROUTER_URL } from "../../supabase/functions/extract-cards/providers.ts";
import { MODELS_URL } from "./models.ts";
import { denoIo, main } from "./run.ts";

const MODEL = {
  id: "vendor/cheap",
  created: 1,
  architecture: {
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
  },
  supported_parameters: ["max_tokens", "response_format", "structured_outputs"],
  pricing: {
    prompt: "0.000001",
    completion: "0.000004",
    image: "0",
    request: "0",
  },
};
const CARD = {
  kind: "vocabulary",
  type: "concept",
  front: "apple",
  answer: null,
  topic: "Fruit",
  senses: [{ labels: [], meaning: "사과", examples: [] }],
  extras: [],
  pronunciation: null,
  examples: [],
  table: null,
  cloze: null,
};

const fakeFetch: typeof fetch = (input) => {
  const url = String(input);
  if (url === MODELS_URL) {
    return Promise.resolve(Response.json({ data: [MODEL] }));
  }
  if (url === OPENROUTER_URL) {
    return Promise.resolve(Response.json({
      choices: [{ message: { content: JSON.stringify({ cards: [CARD] }) } }],
      usage: { prompt_tokens: 1000, completion_tokens: 50, cost: 0.001 },
    }));
  }
  return Promise.reject(new Error(`unexpected request to ${url}`));
};

Deno.exit(await main(Deno.args, { ...denoIo(), fetch: fakeFetch }));
