# Invoice personalizada: dados disponíveis

Cada campo do PDF aprovado e a origem dele no sistema. "Novo" é o que não existia e entrou com esta feature.

| Campo do PDF | Origem | Status |
| --- | --- | --- |
| Número `EB-2026-000418` | `customer_invoices.invoice_number`, sequência anual em `customer_invoice_sequences` | Novo. Antes só existia o número da Stripe (`invoice.number`). |
| Status (Payment due / Paid) | `invoice.status` da Stripe | Existia |
| Data de emissão | `invoice.status_transitions.finalized_at` (ou `created`) | Existia |
| Vencimento / data do pagamento | `invoice.due_date` (cobrança automática não tem: usa a emissão) / `status_transitions.paid_at` | Existia |
| Nome (Bill to / Ship to) | `invoice.customer_name` (nome do cliente na Stripe, gravado no checkout) | Existia |
| E-mail | `invoice.customer_email`, senão `stripe_subscriptions.customer_email` | Existia |
| Endereço de cobrança | O checkout não coleta endereço de cobrança separado. A Stripe recebe o endereço de entrega como endereço do cliente. Bill to usa o mesmo endereço. | Existia (é o de entrega) |
| Endereço de entrega | `stripe_subscriptions.address` (rua, número, complemento, cidade, estado, CEP/ZIP, país), senão `invoice.customer_shipping` | Existia |
| Linhas (descrição, qtd, unitário, valor) | Linhas da invoice Stripe. O nome da receita vem do catálogo: price da Stripe → variação (`wp_postmeta`: sabor e peso). | Existia. A descrição localizada é nova. |
| Período de serviço | `line.period.start/end` da Stripe | Existia |
| Subtotal, frete, impostos, total, pago, a pagar | `invoice.lines`, produto de frete (`shipping_product_id`), `total_taxes`, `total`, `amount_paid`, `amount_remaining` | Existia |
| Desconto / crédito aplicado | `total_discount_amounts`, `total − amount_due` | Existia. Não aparece no PDF aprovado: só entra quando houver. |
| Botão "Pay online" | `invoice.hosted_invoice_url` (só quando em aberto) | Existia |
| Nome do pet nas observações | `stripe_subscriptions.pets_snapshot` / `plan_selection` | Existia |
| Emitente, CNPJ, cidade, e-mail de suporte | Não existia no banco. Fixo em `src/core/invoice/invoice-copy.js`, conforme o PDF aprovado. | Novo (constante) |
| Arquivo PDF guardado | `INVOICE_PDF_DIR/<número>.pdf` + `customer_invoices.pdf_filename/pdf_sha256` | Novo |
| Envio ao comprador e data | `customer_invoices.email_status`, `email_sent_at`, `email_to`, `email_attempts`, `email_last_error` | Novo |

## Diferenças em relação ao PDF aprovado

- **Sabor `turkey`**: a loja vende essa receita como "Chicken" / "Frango". A fatura imprime o nome vendido, não "Turkey/Peru" do exemplo.
- **Tamanho do pack nos EUA**: a loja mostra onças (`10.6 oz`). O exemplo em inglês mostrava `300 g`.
- **Artigo antes do nome do pet**: "alimentar Luna", não "a Luna", porque o sistema não sabe o gênero do pet.
- **Fatura paga**: o PDF aprovado mostra só o estado "pagamento pendente". A invoice enviada após a cobrança usa o mesmo layout, com selo "PAGO", "Data do pagamento", sem botão de pagar e "Valor a pagar R$ 0,00".

## Loja (cliente final)

Nenhuma tela da loja pede para mostrar ou baixar a invoice. O histórico de "Meu Plano" só mostra o texto "Invoice {id}". Nada foi adicionado à loja. O cliente recebe o PDF anexado ao e-mail.
