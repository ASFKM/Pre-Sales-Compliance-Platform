import { describe, expect, it } from "vitest";
import {
  codigoDaLinha,
  montarItensDe,
  STATUS_NO_CONTRATO,
  type ItemDoBom,
  type LinhaDaFolha,
} from "./crmProposal";

// CDC 16 — Fase 4. A regra da D23 (itens casam por código) e o mapa de status, decididos aqui e
// prováveis sem banco. O resto da fase é provado por execução real contra o CRM vivo.

function linha(p: Partial<LinhaDaFolha> = {}): LinhaDaFolha {
  return {
    bomItemId: "b1",
    rawPartNumber: null,
    rawDescription: "Switch 24 portas",
    quantity: 2,
    finalUnitPrice: 500,
    discountPercent: 0,
    matchedItem: null,
    ...p,
  };
}

describe("cdc16 F4 — de onde sai o código do item (D23)", () => {
  it("prefere o erpCode: é o vocabulário que os dois produtos compartilham", () => {
    expect(
      codigoDaLinha(
        linha({
          rawPartNumber: "SW-EDITAL",
          matchedItem: { erpCode: "ERP-1", itemCode: "INT-1", pn: "PN-1", description: null },
        })
      )
    ).toBe("ERP-1");
  });

  it("cai para itemCode, depois pn, depois o part number do edital", () => {
    expect(
      codigoDaLinha(
        linha({ matchedItem: { erpCode: null, itemCode: "INT-1", pn: "PN-1", description: null } })
      )
    ).toBe("INT-1");
    expect(
      codigoDaLinha(
        linha({ matchedItem: { erpCode: null, itemCode: null, pn: "PN-1", description: null } })
      )
    ).toBe("PN-1");
    expect(codigoDaLinha(linha({ rawPartNumber: "SW-EDITAL" }))).toBe("SW-EDITAL");
  });

  it("devolve undefined quando não há código nenhum — item solto é legítimo", () => {
    expect(codigoDaLinha(linha())).toBeUndefined();
  });
});

describe("cdc16 F4 — os itens que viajam", () => {
  const bom: ItemDoBom[] = [
    { item_id: "b1", part_number: "PN-DO-EDITAL", sku: "SKU-1" },
    { item_id: "b2", sku: "SKU-2" },
  ];

  it("usa a tabela manual quando ela existe: é o que o cliente vê na proposta", () => {
    const itens = montarItensDe(
      [
        {
          item_id: "b1",
          product_or_service: "Switch 24 portas",
          quantity: 2,
          unit_price: 500.25,
          total_price: 1000.5,
          discount: 0,
        },
      ],
      [linha({ bomItemId: "b1", matchedItem: { erpCode: "ERP-1", itemCode: null, pn: null, description: null } })],
      bom
    );
    expect(itens).toHaveLength(1);
    expect(itens[0].description).toBe("Switch 24 portas");
    expect(itens[0].line_total).toBe(1000.5);
    // O código veio da FOLHA, por `item_id` — a tabela manual não tem campo de código.
    expect(itens[0].code).toBe("ERP-1");
  });

  it("a folha vence o BOM: revisado por gente ganha de extraído do edital", () => {
    const itens = montarItensDe(
      [{ item_id: "b1", product_or_service: "Switch", quantity: 1, unit_price: 10, total_price: 10 }],
      [linha({ bomItemId: "b1", matchedItem: { erpCode: "ERP-1", itemCode: null, pn: null, description: null } })],
      bom
    );
    expect(itens[0].code).toBe("ERP-1");
    expect(itens[0].code).not.toBe("PN-DO-EDITAL");
  });

  it("o BOM preenche o que a folha não sabia", () => {
    const itens = montarItensDe(
      [{ item_id: "b2", product_or_service: "Câmera", quantity: 1, unit_price: 10, total_price: 10 }],
      [],
      bom
    );
    expect(itens[0].code).toBe("SKU-2");
  });

  it("item sem correspondência em lugar nenhum viaja SEM código, e não some", () => {
    const itens = montarItensDe(
      [{ item_id: "desconhecido", product_or_service: "Serviço", quantity: 1, unit_price: 800, total_price: 800 }],
      [],
      bom
    );
    expect(itens).toHaveLength(1);
    expect(itens[0].code).toBeUndefined();
    expect(itens[0].line_total).toBe(800);
  });

  it("calcula o total da linha quando a tabela não o traz", () => {
    const itens = montarItensDe(
      [{ item_id: "b1", product_or_service: "X", quantity: 3, unit_price: 10.5 }],
      [],
      []
    );
    expect(itens[0].line_total).toBe(31.5);
  });

  it("arredonda dinheiro a duas casas: o outro lado grava numeric(14,2)", () => {
    const itens = montarItensDe(
      [{ item_id: "b1", product_or_service: "X", quantity: 3, unit_price: 10.333333 }],
      [],
      []
    );
    expect(itens[0].unit_price).toBe(10.33);
    expect(itens[0].line_total).toBe(30.99);
  });

  it("só declara desconto quando há desconto — zero não vira campo", () => {
    const semDesconto = montarItensDe(
      [{ item_id: "b1", product_or_service: "X", quantity: 1, unit_price: 10, total_price: 10, discount: 0 }],
      [],
      []
    );
    expect(semDesconto[0].discount_percent).toBeUndefined();
    const comDesconto = montarItensDe(
      [{ item_id: "b1", product_or_service: "X", quantity: 1, unit_price: 10, total_price: 9, discount: 10 }],
      [],
      []
    );
    expect(comDesconto[0].discount_percent).toBe(10);
  });

  it("sem tabela manual, os itens saem da folha — o caso da proposta técnica", () => {
    const itens = montarItensDe(
      null,
      [
        linha({ quantity: 2, finalUnitPrice: 500, rawPartNumber: "PN-A" }),
        // Linha sem preço fechado não vira item: mandá-la faria o CRM somar zero num compromisso.
        linha({ bomItemId: "b3", quantity: 1, finalUnitPrice: null }),
      ],
      []
    );
    expect(itens).toHaveLength(1);
    expect(itens[0].code).toBe("PN-A");
    expect(itens[0].line_total).toBe(1000);
  });

  it("devolve lista vazia quando não há nem tabela nem folha", () => {
    expect(montarItensDe(null, [], [])).toEqual([]);
  });
});

describe("cdc16 F4 — o mapa para os estados do contrato", () => {
  it("traduz os cinco estados que este produto produz", () => {
    expect(STATUS_NO_CONTRATO.draft).toBe("draft");
    expect(STATUS_NO_CONTRATO.submitted).toBe("in_approval");
    expect(STATUS_NO_CONTRATO.approved).toBe("approved");
    expect(STATUS_NO_CONTRATO.released).toBe("sent");
  });

  it("`rejected` continua `rejected` — é a aprovação INTERNA recusada, não o cliente", () => {
    // O CRM sabe da diferença e mapeia para 'rascunho', não para 'recusada'. Se este lado
    // traduzisse para outra coisa, aquela decisão de lá ficaria sem base.
    expect(STATUS_NO_CONTRATO.rejected).toBe("rejected");
  });

  it("cobre todo o enum deste produto, sem buraco", () => {
    for (const status of ["draft", "submitted", "approved", "rejected", "released"]) {
      expect(STATUS_NO_CONTRATO[status]).toBeTruthy();
    }
  });
});
