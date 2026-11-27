"""Hackathon Batch Mode CLI (`python -m app.cli.batch --lote ../docs/reto --output salida.json`)."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

from app.core.logging import setup_logging
from app.services.agent.orchestrator import evaluate_proposals_core
from app.services.ingestion.pipeline import SUPPORTED_DOCUMENT_EXTENSIONS, ingest_document
from app.services.llm.client import UnifiedLLMClient
from app.services.reports.salida_json import SalidaJsonMetadataError, validate_salida_json

SUPPORTED_EXTS = SUPPORTED_DOCUMENT_EXTENSIONS


def _r2(valor: object) -> float:
    try:
        return round(float(valor or 0.0), 2)
    except (TypeError, ValueError):
        return 0.0


def _texto(r) -> str:
    doc = getattr(r, "ingested_doc", None)
    return (getattr(doc, "visible_text", "") or "") if doc else ""


def _rif(r, lote_dir: Path) -> str | None:
    if r.supplier_rif:
        return r.supplier_rif
    texto = _texto(r)
    archivo = lote_dir / "propuestas" / r.original_filename
    if not texto and archivo.suffix.lower() == ".pdf" and archivo.is_file():
        from app.services.ingestion.pdf_parser import extract_pdf

        pdf = extract_pdf(archivo.read_bytes())
        texto = pdf.visible_text or pdf.full_raw_text
    m = re.search(r"\b([JVEGP])\s*-\s*(\d{6,9})\s*-\s*(\d)\b", texto, re.I)
    return f"{m.group(1).upper()}-{m.group(2)}-{m.group(3)}" if m else None


_RUIDO_NOMBRE = re.compile(r"#|workspace|discord|slack|telegram|whatsapp|cotizaci[oó]n|propuesta", re.I)


def _nombre(r) -> str:
    """Nombre del proveedor; si el leído trae ruido (canal de chat, encabezado), se usa el del archivo."""
    del_archivo = re.sub(r"^Propuesta_\d+_", "", r.proposal_identifier).replace("__", " & ").replace("_", " ")
    nombre = re.sub(r"\s+", " ", (r.supplier_name or "")).strip()
    if nombre and not _RUIDO_NOMBRE.search(nombre):
        return nombre
    return del_archivo


def _aritmetica(r) -> dict:
    declarado = float(r.declared_total_usd or 0.0)
    cobertura = float(r.computed_subtotal_usd or 0.0) / declarado if declarado > 0 else 0.0
    if r.arithmetic_valid:
        return {"verificada": True, "correcta": True, "diferencia_usd": 0.0}
    if any(d.get("code") == "error_aritmetico" for d in (r.discard_reasons or [])):
        return {"verificada": True, "correcta": False, "diferencia_usd": _r2(r.arithmetic_discrepancy_usd)}
    return {
        "verificada": False,
        "correcta": None,
        "nota": f"Partidas leídas parcialmente ({cobertura:.0%} del total declarado): no se declara error aritmético.",
    }


def _detalle_completo(output, lote_dir: Path) -> dict:
    """Resumen del lote y ficha de cada propuesta (proveedor, montos, costo real, puntajes y dictamen)."""
    fichas = []
    for r in sorted(output.results, key=lambda x: x.rank_position):
        fichas.append(
            {
                "puesto": r.rank_position,
                "propuesta": r.proposal_identifier,
                "archivo": r.original_filename,
                "procesado": r.processed_at_iso,
                "estado": "valida" if r.is_valid else "descartada",
                "proveedor": {
                    "nombre": _nombre(r),
                    "rif": _rif(r, lote_dir),
                    "representante": r.supplier_representative,
                    "telefono": r.supplier_phone,
                    "correo": r.supplier_email,
                    "ubicacion": r.supplier_location,
                },
                "montos": {
                    "moneda_declarada": r.declared_currency,
                    "total_declarado": _r2(r.declared_total_original),
                    "total_declarado_usd": _r2(r.declared_total_usd),
                    "subtotal_calculado_usd": _r2(r.computed_subtotal_usd),
                    "envio_usd": _r2(r.shipping_cost_usd),
                    "instalacion_usd": _r2(r.installation_cost_usd),
                    "recargos_ocultos_usd": _r2(r.hidden_surcharges_usd),
                    "iva_usd": _r2(r.taxes_iva_usd),
                    "costo_total_real_usd": _r2(r.adjusted_tco_usd),
                    "costo_total_real_ves": _r2(r.adjusted_tco_ves),
                },
                "aritmetica": _aritmetica(r),
                "puntajes": {
                    "tecnico": _r2(r.technical_score),
                    "economico": _r2(r.economic_score),
                    "global": _r2(r.overall_score),
                },
                "motivos_descarte": [
                    {"codigo": d.get("code"), "detalle": d.get("detail")} for d in (r.discard_reasons or [])
                ],
                "instrucciones_ocultas_detectadas": bool(r.prompt_injection_detected),
                "hallazgos_tecnicos": list(r.technical_findings or []),
                "letra_pequena": list(r.fine_print_findings or []),
                "dictamen": r.discard_verdict_text if not r.is_valid else r.recommendation_rationale,
            }
        )
    validas = [f for f in fichas if f["estado"] == "valida"]
    return {
        "lote": {
            "carpeta": lote_dir.name,
            "propuestas_recibidas": len(fichas),
            "validas": len(validas),
            "descartadas": len(fichas) - len(validas),
            "recomendada": output.recommended_identifier,
            "tasa_bcv": {"bs_por_usd": _r2(output.bcv_rate), "fuente": output.bcv_source},
            "motor": output.llm_provider,
        },
        "detalle": fichas,
    }


async def _run_cli(args: argparse.Namespace) -> int:
    lote_dir = Path(args.lote).resolve()
    project_pdf = lote_dir / "proyecto.pdf"
    proposals_dir = lote_dir / "propuestas"

    if not project_pdf.exists():
        print(f"ERROR: No se encontró '{project_pdf}'", file=sys.stderr)
        return 1
    if not proposals_dir.is_dir():
        print(f"ERROR: No se encontró la carpeta '{proposals_dir}'", file=sys.stderr)
        return 1

    proposal_paths = sorted(
        p for p in proposals_dir.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS
    )
    if not proposal_paths:
        print(f"ERROR: No hay propuestas soportadas en '{proposals_dir}'", file=sys.stderr)
        return 1

    llm = UnifiedLLMClient()
    project_doc = await ingest_document("proyecto.pdf", project_pdf.read_bytes(), llm_client=llm)
    files_payload = [(None, p.name, p.read_bytes()) for p in proposal_paths]

    async def print_trace(
        phase: str,
        proposal_identifier: str | None,
        tool_name: str | None,
        message: str,
        metadata: dict | None,
    ) -> None:
        tag = f"[{phase}]"
        if proposal_identifier:
            tag += f"[{proposal_identifier}]"
        if tool_name:
            tag += f"({tool_name})"
        print(f"{tag} {message}")

    repo_dir = Path(__file__).resolve().parents[3]
    try:
        output = await evaluate_proposals_core(
            project_name=f"Lote {lote_dir.name}",
            project_location="La Hoyada, Caracas",
            project_requirements_text=project_doc.visible_text,
            proposal_files=files_payload,
            db=None,
            enable_web_search=not args.no_web_search,
            bcv_rate_override=args.bcv_rate,
            trace_emitter=print_trace if args.verbose else None,
            repo_dir=repo_dir,
        )
    except SalidaJsonMetadataError as exc:
        print(f"ERROR de metadatos salida.json: {exc}", file=sys.stderr)
        return 1

    # Detalle completo de cada propuesta. Los campos sobrantes los permite el formato oficial y la calificación
    # automática los ignora: los 7 campos calificados (reto, repositorio, commit, inicio, fin, procesados y
    # ranking) no cambian.
    output.salida_json.update(_detalle_completo(output, lote_dir))

    ok, errors = validate_salida_json(
        output.salida_json,
        expected_filenames=[p.name for p in proposal_paths],
    )
    out_path = Path(args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output.salida_json, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("\n" + "=" * 72)
    print(f"Archivo generado: {out_path}")
    print(f"Validación formato salida.json: {'OK' if ok else 'FALLÓ -> ' + '; '.join(errors)}")
    print(f"Tasa BCV usada: {output.bcv_rate:.4f} Bs/USD ({output.bcv_source})")
    print(f"Propuesta recomendada: {output.recommended_identifier}")
    print("\nRanking final:")
    for r in output.results:
        status_str = "VÁLIDA   " if r.is_valid else "DESCARTADA"
        extra = (
            f"TCO=${r.adjusted_tco_usd:,.2f} | Téc={r.technical_score:.1f}"
            if r.is_valid
            else "; ".join(d["code"] for d in r.discard_reasons)
        )
        print(f"  {r.rank_position:2d}. [{status_str}] {r.proposal_identifier:45s} | {extra}")
    print("=" * 72)
    return 0 if ok else 2


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Modo Lote — Agente Evaluador de Propuestas de Servicios (genera salida.json)."
    )
    parser.add_argument("--lote", required=True, help="Ruta a la carpeta lote/ con proyecto.pdf y propuestas/")
    parser.add_argument("--output", default="salida.json", help="Ruta de salida para salida.json")
    parser.add_argument("--no-web-search", action="store_true", help="Desactivar búsqueda web de precios")
    parser.add_argument("--bcv-rate", type=float, default=None, help="Tasa BCV manual opcional")
    parser.add_argument("-v", "--verbose", action="store_true", help="Mostrar trazabilidad paso a paso")
    args = parser.parse_args()
    setup_logging(debug=args.verbose)
    raise SystemExit(asyncio.run(_run_cli(args)))


if __name__ == "__main__":
    main()
