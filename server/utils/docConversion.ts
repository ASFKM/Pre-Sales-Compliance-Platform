import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/*
 * Conversao .doc -> .docx no momento do upload de um template de proposta (F6).
 *
 * Por que isto existe: o motor de merge deste produto e o docxtemplater
 * (server/utils/docxTemplateEngine.ts), que so abre OOXML de verdade - um .docx e um ZIP, um .doc
 * e um binario OLE2. Antes desta fase o .doc era ACEITO no cadastro e depois ignorado em silencio
 * na geracao (o merge so rodava para file_type === "docx"), entregando uma proposta com o layout
 * generico no lugar do papel timbrado do cliente sem avisar ninguem. A decisao do dono foi
 * converter no upload em vez de recusar o formato.
 *
 * O binario vem do LibreOffice (`soffice`), instalado na imagem (ver Dockerfile). A conversao e
 * deterministica: e troca de formato de arquivo, nunca interpretacao de conteudo - nenhuma IA
 * participa deste caminho.
 *
 * Sobre escrita em disco: o `soffice` nao le stdin nem escreve em stdout, so arquivo -> arquivo,
 * entao este modulo e a UNICA parte do servidor que precisa de um diretorio temporario real. Ele
 * usa os.tmpdir() (o tmpfs `/tmp` declarado no docker-compose.yml) e apaga o diretorio no finally,
 * inclusive quando a conversao falha. Isso corrige, de proposito, a afirmacao do comentario da F8b
 * no compose de que "nao ha LibreOffice, nem diretorio de conversao" - passou a haver, e o tmpfs
 * que la era "seguro-desemprego" agora e requisito medido.
 */

// Uma conversao normal leva menos de 5s; o teto existe para o caso do soffice travar segurando um
// perfil de usuario corrompido, que sem timeout penduraria a requisicao de upload para sempre.
const TIMEOUT_DE_CONVERSAO_MS = 60_000;

export class ConversaoDeDocumentoError extends Error {
  constructor(message: string, readonly causa?: unknown) {
    super(message);
    this.name = "ConversaoDeDocumentoError";
  }
}

/**
 * Converte um .doc (binario do Word) em .docx real, devolvendo os bytes do resultado.
 *
 * Lanca ConversaoDeDocumentoError quando o LibreOffice nao esta instalado, estoura o timeout ou
 * nao produz arquivo - nunca devolve o buffer de entrada como se tivesse convertido, porque um
 * "sucesso" falso aqui reintroduziria exatamente a falha silenciosa que esta fase existe para
 * eliminar.
 */
export async function converterDocParaDocx(bufferDoDoc: Buffer): Promise<Buffer> {
  const diretorio = await mkdtemp(path.join(tmpdir(), "template-doc-"));
  const caminhoEntrada = path.join(diretorio, "entrada.doc");
  // O --convert-to nomeia a saida pelo nome da entrada, so trocando a extensao.
  const caminhoSaida = path.join(diretorio, "entrada.docx");
  // Perfil proprio por conversao: sem isto, duas conversoes simultaneas disputam o mesmo perfil
  // default do LibreOffice e uma delas falha com "user installation is locked".
  const perfil = path.join(diretorio, "perfil");

  try {
    await writeFile(caminhoEntrada, bufferDoDoc);

    try {
      await execFileAsync(
        "soffice",
        [
          "--headless",
          "--norestore",
          `-env:UserInstallation=file://${perfil}`,
          "--convert-to",
          "docx",
          caminhoEntrada,
          "--outdir",
          diretorio,
        ],
        { timeout: TIMEOUT_DE_CONVERSAO_MS }
      );
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        throw new ConversaoDeDocumentoError(
          "O conversor de documentos (LibreOffice) não está disponível neste servidor, então um template .doc não pode ser convertido. Salve o arquivo como .docx e envie novamente.",
          err
        );
      }
      if (err?.killed || err?.signal === "SIGTERM") {
        throw new ConversaoDeDocumentoError(
          "A conversão do template .doc excedeu o tempo limite e foi interrompida. Salve o arquivo como .docx e envie novamente.",
          err
        );
      }
      throw new ConversaoDeDocumentoError(
        "Não foi possível converter o template .doc para .docx. Salve o arquivo como .docx e envie novamente.",
        err
      );
    }

    // O soffice sai com codigo 0 mesmo quando desiste do arquivo (entrada corrompida, formato que
    // ele nao reconhece), apenas sem escrever a saida - por isso o sucesso e medido pela leitura
    // do arquivo convertido, nao pelo exit code.
    try {
      return await readFile(caminhoSaida);
    } catch (err) {
      throw new ConversaoDeDocumentoError(
        "A conversão do template .doc não produziu um arquivo .docx — o arquivo enviado pode estar corrompido ou não ser um .doc real. Salve o arquivo como .docx e envie novamente.",
        err
      );
    }
  } finally {
    await rm(diretorio, { recursive: true, force: true }).catch(() => {
      // Limpeza best-effort: o diretorio vive no tmpfs e morre com o container de qualquer forma;
      // deixar um erro de limpeza mascarar o erro real da conversao seria pior.
    });
  }
}
