import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatZar } from "./domain";
import type { BusinessSettings, Invoice } from "./types";

const styles = StyleSheet.create({
  page: { padding: 44, fontFamily: "Helvetica", fontSize: 9, color: "#173b36" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 34 },
  brand: { fontSize: 22, fontWeight: 700, color: "#123d37" },
  invoice: { fontSize: 11, textAlign: "right", color: "#53706b" },
  columns: { flexDirection: "row", gap: 32, marginBottom: 30 },
  column: { flex: 1 },
  label: { textTransform: "uppercase", letterSpacing: 1.2, color: "#7a8f8b", fontSize: 7, marginBottom: 6 },
  name: { fontSize: 12, fontWeight: 700, marginBottom: 5 },
  line: { marginBottom: 3, lineHeight: 1.4 },
  tableHeader: { flexDirection: "row", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#b8cbc7", color: "#53706b", fontSize: 7, textTransform: "uppercase" },
  row: { flexDirection: "row", paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: "#e3ece9" },
  date: { width: "18%" }, student: { width: "34%" }, detail: { width: "30%" }, amount: { width: "18%", textAlign: "right" },
  total: { marginTop: 20, marginLeft: "auto", width: "42%", paddingTop: 12, borderTopWidth: 2, borderTopColor: "#d58a55", flexDirection: "row", justifyContent: "space-between", fontSize: 14, fontWeight: 700 },
  footer: { marginTop: 38, backgroundColor: "#f1f6f4", padding: 14, lineHeight: 1.5 },
});

function InvoiceDocument({ invoice, settings }: { invoice: Invoice; settings: BusinessSettings }) {
  return <Document title={invoice.number ?? "TeachNotes invoice"} author={settings.tutorName}>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}><View><Text style={styles.brand}>TeachNotes</Text><Text>{settings.tutorName}</Text></View><View><Text style={styles.invoice}>INVOICE</Text><Text style={styles.invoice}>{invoice.number}</Text></View></View>
      <View style={styles.columns}><View style={styles.column}><Text style={styles.label}>From</Text><Text style={styles.name}>{settings.tutorName}</Text><Text style={styles.line}>{settings.tutorEmail}</Text><Text style={styles.line}>{settings.tutorPhone}</Text><Text style={styles.line}>{settings.tutorAddress}</Text></View><View style={styles.column}><Text style={styles.label}>Bill to</Text><Text style={styles.name}>{invoice.recipientName}</Text><Text style={styles.line}>Period {new Date(invoice.periodStart).toLocaleDateString("en-ZA")} – {new Date(invoice.periodEnd).toLocaleDateString("en-ZA")}</Text><Text style={styles.line}>Due {invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString("en-ZA") : "On receipt"}</Text></View></View>
      <View style={styles.tableHeader}><Text style={styles.date}>Date</Text><Text style={styles.student}>Student</Text><Text style={styles.detail}>Lesson</Text><Text style={styles.amount}>Amount</Text></View>
      {invoice.lines.map((line) => <View style={styles.row} key={line.lessonId}><Text style={styles.date}>{new Date(line.lessonDate).toLocaleDateString("en-ZA")}</Text><Text style={styles.student}>{line.studentName}</Text><Text style={styles.detail}>{line.durationMinutes} min · {line.status.replaceAll("_", " ")}</Text><Text style={styles.amount}>{formatZar(line.amountCents)}</Text></View>)}
      <View style={styles.total}><Text>Total</Text><Text>{formatZar(invoice.totalCents)}</Text></View>
      <View style={styles.footer}><Text style={styles.label}>Payment details</Text><Text>{settings.bankDetails || `Payment due within ${settings.paymentTermsDays} days. Use the invoice number as your reference.`}</Text></View>
    </Page>
  </Document>;
}

export async function renderInvoicePdf(invoice: Invoice, settings: BusinessSettings) {
  return renderToBuffer(<InvoiceDocument invoice={invoice} settings={settings} />);
}
