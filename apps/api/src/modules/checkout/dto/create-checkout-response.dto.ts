export type CreateCheckoutResponseDto = {
  checkoutOrderId: string;
  paymentIntentRef: string;
  status: string;
};
