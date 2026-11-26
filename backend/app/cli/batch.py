"""Hackathon Batch Mode CLI (`python -m app.cli.batch --lote ../docs/reto --output salida.json`)."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.core.logging import setup_logging
from app.services.agent.orchestrator import evaluate_proposals_core
from app.services.ingestion.pipeline import SUPPORTED_DOCUMENT_EXTENSIONS, ingest_document
from app.services.llm.client import UnifiedLLMClient
from app.services.reports.salida_json import validate_salida_json

SUPPORTED_EXTS = SUPPORTED_DOCUMENT_EXTENSIONS


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

    output = await evaluate_proposals_core(
        project_name=f"Lote {lote_dir.name}",
        project_location="La Hoyada, Caracas",
        project_requirements_text=project_doc.visible_text,
        proposal_files=files_payload,
        db=None,
        enable_web_search=not args.no_web_search,
        bcv_rate_override=args.bcv_rate,
        trace_emitter=print_trace if args.verbose else None,
    )

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
