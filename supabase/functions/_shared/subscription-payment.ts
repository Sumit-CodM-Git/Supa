/** Only call after provider signature, captured status, order and ownership checks. */
export async function finalizeSubscriptionPayment(
  supabase: any,
  input: {
    paymentId: string;
    orderId: string;
    ownerUserId: string;
    society: string;
    tower: string | null;
    block: string | null;
    flatNumber: string;
    planCode: string;
    planPriceId: string | null;
    validityMonths: number;
    amountPaise: number;
    billingPeriod?: string;
    paymentPurpose: string;
    targetSubscriptionId: string | null;
    recoverySubscriptionId?: string;
    recoveryEndDate?: string;
  },
) {
  const { data, error } = await supabase.rpc(
    "finalize_razorpay_subscription_payment", { p_input: input },
  );
  if (error) throw new Error(`Failed to finalize subscription payment: ${error.message}`);
  if (!data?.subscriptionId) throw new Error("Subscription payment returned no subscription");
  return data as {
    subscriptionId: string;
    planCode: string;
    startDate: string;
    endDate: string | null;
    paymentPurpose: string;
    alreadyProcessed: boolean;
    paymentRecordId: string;
  };
}
