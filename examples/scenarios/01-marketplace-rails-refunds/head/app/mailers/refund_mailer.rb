class RefundMailer < ApplicationMailer
  def confirmation(refund)
    @refund = refund
    mail to: refund.order.email, subject: "Refund confirmed"
  end
end
