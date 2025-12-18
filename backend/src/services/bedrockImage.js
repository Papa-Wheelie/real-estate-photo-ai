import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-west-2",
});

export async function invokeTitanImageVariation({ modelId, body }) {
  const cmd = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: Buffer.from(JSON.stringify(body)),
  });

  const resp = await client.send(cmd);
  return JSON.parse(Buffer.from(resp.body).toString("utf8"));
}
