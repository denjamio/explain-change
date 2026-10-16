class RefundMailer < ApplicationMailer
  def confirmation(refund)
    @refund = refund
    mail to: refund.order.email, subject: "Reembolso confirmado"
  end
end
