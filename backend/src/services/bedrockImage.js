import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || "us-west-2",
});

export async function titanInpaint({
  imageBase64,
  maskBase64,
  width,
  height,
  text,
  negativeText,
  cfgScale = 5,
}) {
  if (!width || !height) throw new Error("Missing width/height for Titan inpaint");

  const modelId = process.env.BEDROCK_IMAGE_MODEL_ID || "amazon.titan-image-generator-v2:0";

  const body = {
    taskType: "INPAINTING",
    inPaintingParams: {
      image: imageBase64,
      maskImage: maskBase64,
      text: text ?? "",
      negativeText: negativeText ?? "",
    },
    imageGenerationConfig: {
      quality: "standard",
      numberOfImages: 1,
      width,
      height,
      cfgScale,
    },
  };

  const cmd = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: Buffer.from(JSON.stringify(body)),
  });

  const resp = await client.send(cmd);
  return JSON.parse(Buffer.from(resp.body).toString("utf8"));
}
