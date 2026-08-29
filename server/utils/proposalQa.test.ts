import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import {
  conferirItensDoBomNoTexto,
  conferirTotalDePrecificacao,
  conferirVariaveisVazias,
  encontrarPlaceholdersRemanescentes,
  extrairTextoDoDocx,
  revisarDocumentoGerado,
} from "./proposalQa";

/**
 * .docx mínimo de verdade (zip com word/document.xml), montado em memória - o QA lê arquivo real,
 * então o teste não pode passar um Buffer qualquer e fingir que é um documento.
 */
function docxComTexto(paragrafos: string[]): Buffer {
  const corpo = paragrafos.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join("");
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo}</w:body></w:document>`
  );
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

describe("extrairTextoDoDocx", () => {
  it("devolve o texto sem as tags do OOXML", () => {
    const texto = extrairTextoDoDocx(docxComTexto(["Proposta para Prefeitura", "Escopo: CFTV"]));
    expect(texto).toContain("Proposta para Prefeitura");
    expect(texto).toContain("Escopo: CFTV");
    expect(texto).not.toContain("<w:t>");
  });

  it("não cola palavras de parágrafos diferentes", () => {
    const texto = extrairTextoDoDocx(docxComTexto(["Camera", "Switch"]));
    expect(texto).not.toContain("CameraSwitch");
  });
});

describe("encontrarPlaceholdersRemanescentes", () => {
  // O pior desfecho do fluxo: o cliente recebe o código-fonte do template dentro da proposta.
  it("acha marcador que sobrou no documento final", () => {
    const achados = encontrarPlaceholdersRemanescentes(docxComTexto(["Cliente: {{cliente}}", "Total: 100"]));
    expect(achados).toEqual(["{{cliente}}"]);
  });

  it("não acusa nada num documento inteiramente mesclado", () => {
    expect(encontrarPlaceholdersRemanescentes(docxComTexto(["Cliente: Prefeitura", "Total: 100"]))).toEqual([]);
  });

  it("não repete o mesmo marcador aparecendo várias vezes", () => {
    const achados = encontrarPlaceholdersRemanescentes(docxComTexto(["{{cliente}}", "{{cliente}}"]));
    expect(achados).toEqual(["{{cliente}}"]);
  });
});

describe("conferirTotalDePrecificacao", () => {
  const linha = (total: string) => ({
    item: "Câmera",
    quantidade: 1,
    preco_unitario: total,
    preco_total_item: total,
    moeda: "BRL",
  });

  it("aceita quando a soma das linhas bate com o total", () => {
    expect(conferirTotalDePrecificacao([linha("100.00"), linha("50.00")], "150.00")).toEqual([]);
  });

  it("aceita diferença de centavo, que é arredondamento e não erro", () => {
    expect(conferirTotalDePrecificacao([linha("100.00"), linha("50.00")], "150.01")).toEqual([]);
  });

  // O erro que só apareceria quando o cliente conferisse a conta.
  it("acusa quando o total apresentado não é a soma dos itens", () => {
    const achados = conferirTotalDePrecificacao([linha("100.00"), linha("50.00")], "200.00");
    expect(achados).toHaveLength(1);
    expect(achados[0].tipo).toBe("divergencia_de_total");
    expect(achados[0].severidade).toBe("alta");
  });

  it("não tem o que conferir quando não há precificação", () => {
    expect(conferirTotalDePrecificacao([], "0.00")).toEqual([]);
  });
});

describe("conferirItensDoBomNoTexto", () => {
  const bom = [{ equipamento: "Câmera IP" }, { equipamento: "Switch PoE" }];

  it("acusa item do BOM que não chegou ao documento", () => {
    const achados = conferirItensDoBomNoTexto("Fornecimento de Câmera IP", bom, true);
    expect(achados).toHaveLength(1);
    expect(achados[0].descricao).toContain("Switch PoE");
  });

  it("fica quieto quando todos os itens aparecem", () => {
    expect(conferirItensDoBomNoTexto("Câmera IP e Switch PoE", bom, true)).toEqual([]);
  });

  // Um template que não lista o BOM não tem nada a conferir - acusar aqui seria ruído.
  it("não confere nada quando o template não usa o bloco de BOM", () => {
    expect(conferirItensDoBomNoTexto("documento sem lista", bom, false)).toEqual([]);
  });
});

describe("conferirVariaveisVazias", () => {
  it("avisa sobre variável do template que saiu em branco", () => {
    const achados = conferirVariaveisVazias(["cliente", "resumo_executivo"], { cliente: "Prefeitura", resumo_executivo: "" });
    expect(achados).toHaveLength(1);
    expect(achados[0].severidade).toBe("media");
    expect(achados[0].descricao).toContain("resumo_executivo");
  });

  it("ignora variável livre que o resolvedor nem conhece", () => {
    expect(conferirVariaveisVazias(["campo_inventado"], { cliente: "Prefeitura" })).toEqual([]);
  });
});

describe("revisarDocumentoGerado", () => {
  it("devolve lista vazia para documento conferido e limpo", () => {
    const achados = revisarDocumentoGerado({
      docxBuffer: docxComTexto(["Cliente: Prefeitura", "Câmera IP"]),
      placeholdersDoTemplate: ["cliente", "bom"],
      variaveisResolvidas: {
        cliente: "Prefeitura",
        bom: [{ equipamento: "Câmera IP" }],
        precificacao: [],
        preco_total: "0.00",
      },
    });
    expect(achados).toEqual([]);
  });

  it("ordena os achados com os de severidade alta primeiro", () => {
    const achados = revisarDocumentoGerado({
      docxBuffer: docxComTexto(["Cliente: {{cliente}}", "resumo em branco"]),
      placeholdersDoTemplate: ["cliente", "resumo_executivo"],
      variaveisResolvidas: { cliente: "Prefeitura", resumo_executivo: "", precificacao: [], preco_total: "0.00" },
    });
    expect(achados.length).toBeGreaterThan(1);
    expect(achados[0].severidade).toBe("alta");
    expect(achados[achados.length - 1].severidade).toBe("media");
  });
});
