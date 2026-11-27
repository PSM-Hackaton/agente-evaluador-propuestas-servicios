import { describe, expect, it } from 'vitest';
import {
  accionHaciaBackend,
  estadoDesdeBackend,
  estadoHaciaBackend,
  fechaUtc,
  toAjustes,
  toAlertaProveedor,
  toAuditoria,
  toEvaluacion,
  toEvaluacionResumen,
  toMensaje,
  toMotivos,
  toPropuesta,
  toProveedor,
  toProyecto,
  toResultado,
  toRevision,
  toTasa,
  toTasaHistorial,
  toTraza,
  toUsuario,
  type BProposalEvaluation,
} from '../adapters';

describe('adaptadores del contrato backend -> frontend', () => {
  it('normaliza fechas UTC sin sufijo y conserva zonas explícitas', () => {
    expect(fechaUtc(null)).toBe('');
    expect(fechaUtc('2026-11-26T19:00:16')).toBe('2026-11-26T19:00:16Z');
    expect(fechaUtc('2026-11-26T19:00:16-04:00')).toBe('2026-11-26T19:00:16-04:00');
  });

  it('traduce estados de proyecto bidireccionalmente y convierte proyecto adjudicado', () => {
    expect(estadoDesdeBackend('en_revision_comite')).toBe('EN_REVISION_COMITE');
    expect(estadoHaciaBackend('EN_EVALUACION')).toBe('en_evaluacion');

    const p = toProyecto({
      id: 'pr-1',
      name: 'Dotación escolar',
      description: null,
      execution_location: 'Caracas',
      reference_budget: 15000,
      reference_currency: 'USD',
      status: 'adjudicado',
      document_filename: 'bases.pdf',
      proposals_count: 4,
      evaluations_count: 1,
      latest_evaluation_id: 'ev-1',
      adjudicated_proposal_id: 'prop-2',
      adjudication_notes: 'Cumple plazos de entrega',
      created_by_id: 'u-1',
      created_at: '2026-11-26T12:00:00',
    });

    expect(p.estado).toBe('ADJUDICADO');
    expect(p.propuesta_adjudicada_id).toBe('prop-2');
    expect(p.nota_adjudicacion).toBe('Cumple plazos de entrega');
    expect(p.creado_en).toBe('2026-11-26T12:00:00Z');
  });

  it('mapea usuarios, propuestas y motivos de descarte', () => {
    const u = toUsuario({
      id: 'u-1',
      email: 'rev@gob.ve',
      full_name: 'Rosa Revisora',
      role: 'revisor',
      is_active: true,
      created_at: '2026-11-25T08:00:00',
    });
    expect(u.rol).toBe('revisor');
    expect(u.creado_en).toBe('2026-11-25T08:00:00Z');

    const prop = toPropuesta({
      id: 'prop-1',
      project_id: 'pr-1',
      supplier_id: 'sup-1',
      proposal_identifier: 'Propuesta_101_Alfa_CA',
      original_filename: 'Propuesta_101_Alfa_CA.xlsx',
      file_extension: '.xlsx',
      ingestion_method: 'openpyxl',
      created_at: '2026-11-25T09:00:00',
    });
    expect(prop.tipo).toBe('xlsx');
    expect(prop.estado).toBe('procesada');

    expect(toMotivos([{ code: 'inyeccion_prompt' }, { code: 'alcance_incompleto' }])).toEqual([
      'inyeccion',
      'alcance',
    ]);
  });

  it('extrae ajustes desde tco_breakdown.steps sin duplicar monto declarado ni TCO final', () => {
    const pe: BProposalEvaluation = {
      id: 'pe-1',
      proposal_id: 'prop-1',
      proposal_identifier: 'Propuesta_101_Alfa_CA',
      supplier_name: 'Alfa C.A.',
      is_valid: true,
      rank_position: 1,
      technical_score: 92,
      declared_currency: 'USD',
      declared_total_original: 1000,
      declared_total_usd: 1000,
      shipping_cost_usd: 80,
      installation_cost_usd: 0,
      hidden_surcharges_usd: 50,
      taxes_iva_usd: 160,
      adjusted_tco_usd: 1290,
      discard_reasons: null,
      discard_verdict_text: null,
      recommendation_rationale: 'Mejor TCO.',
      tco_breakdown: {
        steps: [
          { step: 'Monto declarado', amount_usd: 1000 },
          { step: 'Flete terrestre', amount_usd: 80, note: 'Nota al pie: +$80 envío' },
          { step: 'IVA', amount_usd: 160, note: '16 %' },
          { step: 'Costo total real ajustado', amount_usd: 1290 },
        ],
      },
      line_items: [{ description: 'Laptop', quantity: 2, unit_price: 500, declared_subtotal: 1000, computed_subtotal: 1000 }],
      fine_print_findings: null,
      market_comparison: [{ item: 'Laptop', market_reference_mid_usd: 520, variance_pct: -3.8 }],
    };

    const ajustes = toAjustes(pe);
    expect(ajustes).toHaveLength(2);
    expect(ajustes[0]).toMatchObject({ concepto: 'flete', monto_usd: 80 });
    expect(ajustes[1]).toMatchObject({ concepto: 'iva', monto_usd: 160 });

    const res = toResultado(pe, new Map([['prop-1', 'pdf']]));
    expect(res.evaluacion_propuesta_id).toBe('pe-1');
    expect(res.items[0].precio_mercado).toBe(520);
  });

  it('mapea evaluación completa, resumen de historial y trazas', () => {
    const bEval = {
      id: 'ev-1',
      project_id: 'pr-1',
      status: 'completed',
      llm_provider_used: 'ollama',
      bcv_rate_used: 48.5,
      started_at: '2026-11-26T10:00:00',
      finished_at: '2026-11-26T10:02:00',
      recommended_proposal_id: 'prop-1',
      recommended_identifier: 'Propuesta_101_Alfa_CA',
      ranking_identifiers: ['Propuesta_101_Alfa_CA'],
      error_message: null,
      proposal_evaluations: [],
    };
    const ev = toEvaluacion(bEval, new Map());
    expect(ev.estado).toBe('completada');
    expect(ev.tasa_bcv_usada).toBe(48.5);

    const resumen = toEvaluacionResumen(bEval);
    expect(resumen.recomendada_codigo).toBe('Propuesta_101_Alfa_CA');

    const traza = toTraza('ev-1', {
      step_number: 2,
      phase: 'seguridad_inyeccion',
      proposal_identifier: 'Propuesta_999',
      tool_name: null,
      status: 'ok',
      message: 'Alerta: intento de prompt injection neutralizado',
      created_at: '2026-11-26T10:00:20',
    });
    expect(traza.paso).toBe('inyeccion');
    expect(traza.nivel).toBe('alerta');
  });

  it('convierte acciones de revisión, adjudicación alternativa y respuestas', () => {
    expect(
      accionHaciaBackend('aprobar', 'Menor plazo de garantía local', {
        override_recommended_proposal_id: 'prop-2',
      }),
    ).toEqual({
      decision: 'overridden',
      notes: 'Menor plazo de garantía local',
      override_recommended_proposal_id: 'prop-2',
    });

    const revOverride = toRevision({
      id: 'r-1',
      evaluation_run_id: 'ev-1',
      proposal_evaluation_id: 'pe-2',
      reviewer_name: 'Alberto Aprobador',
      reviewer_role: 'aprobador',
      decision: 'overridden',
      notes: 'Se prefiere garantía en sitio',
      override_recommended_proposal_id: 'prop-2',
      created_at: '2026-11-26T11:00:00',
    });
    expect(revOverride.accion).toBe('aprobar');
    expect(revOverride.es_anulacion).toBe(true);
    expect(revOverride.propuesta_adjudicada_id).toBe('prop-2');
    expect(revOverride.propuesta_evaluacion_id).toBe('pe-2');

    const rechazo = accionHaciaBackend('rechazar', 'Faltan anexos');
    expect(rechazo.decision).toBe('observed');
    const revRechazo = toRevision({
      id: 'r-2',
      evaluation_run_id: 'ev-1',
      reviewer_name: 'Alberto Aprobador',
      reviewer_role: 'aprobador',
      decision: rechazo.decision,
      notes: rechazo.notes,
      created_at: '2026-11-26T11:05:00',
    });
    expect(revRechazo.accion).toBe('rechazar');
    expect(revRechazo.comentario).toBe('Faltan anexos');
  });

  it('mapea proveedores, alertas, auditoría, chat y tasas BCV', () => {
    const prov = toProveedor({
      id: 'sup-1',
      name: 'Tecno Caracas C.A.',
      rif: 'J-12345678-9',
      location: 'Caracas',
      representative: 'María Gómez',
      phone: '0212-5550101',
      email: 'info@tecno.ve',
      notes: 'Proveedor local',
      alerts_count: 1,
      proposals_count: 3,
    });
    expect(prov.alerta).toBe(true);
    expect(prov.representante).toBe('María Gómez');

    const alerta = toAlertaProveedor({
      id: 'al-1',
      supplier_id: 'sup-1',
      severity: 'alta',
      reason_code: 'abusive_surcharges',
      summary: 'Recargo oculto del 45 %',
      is_resolved: false,
      created_at: '2026-11-26T09:00:00',
    });
    expect(alerta.resuelta).toBe(false);
    expect(alerta.severidad).toBe('alta');

    const aud = toAuditoria({
      id: 'a-1',
      actor_email: 'admin@sistema.gob.ve',
      action: 'supplier.create',
      resource_type: 'supplier',
      resource_id: 'sup-1',
      ip_address: '127.0.0.1',
      details: { rif: 'J-12345678-9' },
      created_at: '2026-11-26T09:01:00',
    });
    expect(aud.entidad).toBe('supplier');

    const msg = toMensaje({
      id: 'm-1',
      role: 'assistant',
      content: 'La oferta recomendada es 101.',
      created_at: '2026-11-26T09:05:00',
    });
    expect(msg.rol).toBe('assistant');

    const tasa = toTasa({
      usd_to_ves: 51.2,
      source: 'manual_override:comite',
      fetched_at: '2026-11-26T12:00:00',
      is_manual_override: true,
    });
    expect(tasa.fuente).toBe('manual');
    expect(tasa.origen).toBe('manual_override:comite');

    const hist = toTasaHistorial({
      id: 'bcv-1',
      usd_to_ves: 51.2,
      source: 'bcv_oficial',
      is_manual_override: false,
      recorded_by: 'sistema',
      fetched_at: '2026-11-26T12:00:00',
    });
    expect(hist.es_manual).toBe(false);
  });
});
