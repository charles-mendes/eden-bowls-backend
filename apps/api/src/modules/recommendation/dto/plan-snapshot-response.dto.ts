export type PlanSnapshotResponseDto = {
  snapshotId: string;
  snapshotHash: string;
  recommendationRunId: string;
  subtotalAmount: number;
  discountAmount: number;
  shippingAmount: number | null;
  totalAmount: number;
  currency: string;
};
