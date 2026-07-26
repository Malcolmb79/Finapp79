// Reads a file as base64 so it can travel in a JSON body unchanged.
//
// Statements are uploaded as bytes rather than text because a PDF is binary —
// reading one with file.text() yields mojibake, and the server can no longer
// tell what it was. Sending the bytes lets the server decide CSV vs PDF from
// the content, which matters because bank exports frequently arrive with the
// wrong extension or none at all.
export async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());

  // Chunked rather than String.fromCharCode(...buffer): spreading a
  // multi-megabyte array blows the argument limit and throws.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
