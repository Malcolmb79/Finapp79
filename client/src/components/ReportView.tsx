import { Download, Printer } from "lucide-react";
import { downloadCsv, toCsv } from "../utils/toCsv.js";
import { reportToCsv, type Report, type ReportRow } from "../utils/reports.js";

/**
 * One renderer for every report.
 *
 * The reports differ in what they contain and not at all in how they are
 * read: a heading, line items, a subtotal, a total, and the notes saying what
 * is inside the figures. Drawing each one by hand would mean six places where
 * a total could end up looking like a line item, so there is one.
 *
 * The export sits here rather than on the page for the same reason. A report
 * somebody can read and not take away is a report they will retype.
 */

function emphasisColour(row: ReportRow, index: number): string | undefined {
  const emphasis = row.cells[index]?.emphasis;
  if (emphasis === "good") return "var(--good)";
  if (emphasis === "bad") return "var(--critical)";
  if (emphasis === "muted") return "var(--text-muted)";
  return undefined;
}

export default function ReportView({ report }: { report: Report }) {
  function exportCsv() {
    const { headers, rows } = reportToCsv(report);
    // Dated in the filename, because a folder of "net-worth.csv" files is a
    // folder of files nobody can tell apart.
    downloadCsv(`${report.id}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows));
  }

  return (
    <section className="report">
      <header className="report__header">
        <div>
          <h2 className="report__title">{report.title}</h2>
          <p className="report__period">{report.period}</p>
        </div>
        {/* Hidden on paper: a printed statement with two buttons on it looks
            like a screenshot of software rather than a statement. */}
        <div className="report__actions">
          <button onClick={exportCsv} title="Download this report as a spreadsheet">
            <Download size={13} /> CSV
          </button>
          <button onClick={() => window.print()} title="Print or save as PDF">
            <Printer size={13} /> Print
          </button>
        </div>
      </header>

      <table className="report__table">
        <thead>
          <tr>
            <th>Item</th>
            {report.columns.map((column) => (
              <th key={column} style={{ textAlign: "right" }}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        {report.sections.map((section, sectionIndex) => (
          <tbody key={section.heading ?? sectionIndex}>
            {section.heading && (
              <tr className="report__section-heading">
                <th colSpan={report.columns.length + 1}>{section.heading}</th>
              </tr>
            )}
            {section.rows.length === 0 && section.empty ? (
              <tr>
                <td colSpan={report.columns.length + 1} className="report__empty">
                  {section.empty}
                </td>
              </tr>
            ) : (
              section.rows.map((row, rowIndex) => (
                <tr key={`${row.label}-${rowIndex}`} data-kind={row.kind}>
                  <td>
                    {row.label}
                    {row.detail && <span className="report__detail">{row.detail}</span>}
                  </td>
                  {row.cells.map((cellValue, cellIndex) => (
                    <td
                      key={cellIndex}
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        color: emphasisColour(row, cellIndex),
                      }}
                    >
                      {cellValue.text}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        ))}
      </table>

      {/* Printed along with the figures, deliberately. The caveats are part of
          what the statement claims, and a page that drops them on paper is a
          page that overstates itself exactly where it is least checkable. */}
      {report.notes.length > 0 && (
        <ul className="report__notes">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
