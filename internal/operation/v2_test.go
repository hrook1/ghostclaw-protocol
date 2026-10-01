package operation

import (
	"math/big"
	"testing"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/test"

	"github.com/hrook1/ghostclaw-confidential-payments/internal/circuit"
	"github.com/hrook1/ghostclaw-confidential-payments/internal/model"
)

const (
	v2Context  = "0x1111111111111111111111111111111111111111"
	v2Payer    = "0x2222222222222222222222222222222222222222"
	v2Merchant = "0x3333333333333333333333333333333333333333"
)

func TestDynamicV2FlowAssignmentsSolve(t *testing.T) {
	identity, err := BuildIdentityV2(IdentityRequestV2{
		Context: v2Context, SpendKey: "9001", Account: v2Payer, Action: "1", Nonce: "0",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := test.IsSolved(&circuit.IdentityV2{}, identity.Assignment, ecc.BN254.ScalarField()); err != nil {
		t.Fatal(err)
	}

	deposit, err := BuildDepositV2(DepositRequestV2{
		Context: v2Context, SpendKey: "9001", Amount: "100000000", Blinding: "8001",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := test.IsSolved(&circuit.DepositV2{}, deposit.Assignment, ecc.BN254.ScalarField()); err != nil {
		t.Fatal(err)
	}
	depositInput := spendInputV2(t, deposit.Note, []*big.Int{deposit.Commitment, big.NewInt(0)}, 0)

	payment, err := BuildPaymentV2(PaymentRequestV2{
		Context: v2Context, Payer: v2Payer, Merchant: v2Merchant,
		RecipientOwner: "123456789", RequestDigest: "7001", SpendKey: "9001",
		Input: depositInput, PaymentAmount: "25000000", RecipientBlinding: "8002",
		ChangeBlinding: "8003", RecipientIsLeft: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := test.IsSolved(&circuit.SpendV2{}, payment.Assignment, ecc.BN254.ScalarField()); err != nil {
		t.Fatal(err)
	}
	if payment.OutputRight.Cmp(payment.RecipientCommitment) != 0 {
		t.Fatal("the private recipient position was not applied")
	}

	changeInput := spendInputV2(
		t,
		payment.ChangeNote,
		[]*big.Int{deposit.Commitment, big.NewInt(0), payment.OutputLeft, payment.OutputRight},
		2,
	)
	withdrawal, err := BuildWithdrawalV2(WithdrawalRequestV2{
		Context: v2Context, Payer: v2Payer, Recipient: v2Payer, SpendKey: "9001",
		Input: changeInput, Amount: "10000000", ChangeBlinding: "8004",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := test.IsSolved(&circuit.WithdrawV2{}, withdrawal.Assignment, ecc.BN254.ScalarField()); err != nil {
		t.Fatal(err)
	}

	fullWithdrawal, err := BuildWithdrawalV2(WithdrawalRequestV2{
		Context: v2Context, Payer: v2Payer, Recipient: v2Payer, SpendKey: "9001",
		Input: depositInput, Amount: "100000000", ChangeBlinding: "8005",
	})
	if err != nil {
		t.Fatal(err)
	}
	if fullWithdrawal.ChangeCommitment.Sign() != 0 || fullWithdrawal.ChangeNote != nil {
		t.Fatal("a full withdrawal created a private change note")
	}
	if err := test.IsSolved(&circuit.WithdrawV2{}, fullWithdrawal.Assignment, ecc.BN254.ScalarField()); err != nil {
		t.Fatal(err)
	}
}

func TestV2ReceivedPaymentUsesPrivateOutputPosition(t *testing.T) {
	deposit, err := BuildDepositV2(DepositRequestV2{
		Context: v2Context, SpendKey: "9001", Amount: "100000000", Blinding: "8001",
	})
	if err != nil {
		t.Fatal(err)
	}
	payment, err := BuildPaymentV2(PaymentRequestV2{
		Context: v2Context, Payer: v2Payer, Merchant: v2Merchant,
		RecipientOwner: "123456789", RequestDigest: "7001", SpendKey: "9001",
		Input:         spendInputV2(t, deposit.Note, []*big.Int{deposit.Commitment, big.NewInt(0)}, 0),
		PaymentAmount: "25000000", RecipientBlinding: "8002", ChangeBlinding: "8003",
		RecipientIsLeft: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := ReceivedPaymentRequestV2{
		Context: v2Context, Payer: v2Payer, Merchant: v2Merchant,
		SenderOwner: payment.SenderOwner.String(), RecipientOwner: "123456789",
		RequestDigest: "7001", OutputLeft: payment.OutputLeft.String(),
		OutputRight: payment.OutputRight.String(), Note: payment.RecipientNote,
	}
	inspected, err := InspectReceivedPaymentV2(request)
	if err != nil {
		t.Fatal(err)
	}
	if inspected.RecipientCommitment != payment.RecipientCommitment.String() {
		t.Fatal("recipient commitment mismatch")
	}
	request.Note.OutputPosition = 0
	if _, err = InspectReceivedPaymentV2(request); err == nil {
		t.Fatal("a false output position was accepted")
	}
}

func TestV2RejectsChangedMerklePath(t *testing.T) {
	deposit, err := BuildDepositV2(DepositRequestV2{
		Context: v2Context, SpendKey: "9001", Amount: "100000000", Blinding: "8001",
	})
	if err != nil {
		t.Fatal(err)
	}
	input := spendInputV2(t, deposit.Note, []*big.Int{deposit.Commitment, big.NewInt(0)}, 0)
	input.PathSiblings[0] = "1"
	_, err = BuildPaymentV2(PaymentRequestV2{
		Context: v2Context, Payer: v2Payer, Merchant: v2Merchant,
		RecipientOwner: "123456789", RequestDigest: "7001", SpendKey: "9001",
		Input: input, PaymentAmount: "25000000", RecipientBlinding: "8002",
		ChangeBlinding: "8003", RecipientIsLeft: 1,
	})
	if err == nil {
		t.Fatal("a changed Merkle path was accepted")
	}
}

func TestV2AmountBoundaries(t *testing.T) {
	maximum := "18446744073709551615"
	deposit, err := BuildDepositV2(DepositRequestV2{
		Context: v2Context, SpendKey: "9001", Amount: maximum, Blinding: "8001",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := test.IsSolved(&circuit.DepositV2{}, deposit.Assignment, ecc.BN254.ScalarField()); err != nil {
		t.Fatal(err)
	}
	for _, amount := range []string{"0", "18446744073709551616"} {
		if _, err := BuildDepositV2(DepositRequestV2{
			Context: v2Context, SpendKey: "9001", Amount: amount, Blinding: "8001",
		}); err == nil {
			t.Fatalf("deposit amount %s was accepted", amount)
		}
	}

	input := spendInputV2(t, deposit.Note, []*big.Int{deposit.Commitment, big.NewInt(0)}, 0)
	basePayment := PaymentRequestV2{
		Context: v2Context, Payer: v2Payer, Merchant: v2Merchant,
		RecipientOwner: "123456789", RequestDigest: "7001", SpendKey: "9001",
		Input: input, RecipientBlinding: "8002", ChangeBlinding: "8003", RecipientIsLeft: 1,
	}
	for _, amount := range []string{"0", maximum} {
		request := basePayment
		request.PaymentAmount = amount
		if _, err := BuildPaymentV2(request); err == nil {
			t.Fatalf("payment amount %s was accepted", amount)
		}
	}

	fullWithdrawal, err := BuildWithdrawalV2(WithdrawalRequestV2{
		Context: v2Context, Payer: v2Payer, Recipient: v2Payer, SpendKey: "9001",
		Input: input, Amount: maximum, ChangeBlinding: "8004",
	})
	if err != nil {
		t.Fatal(err)
	}
	if fullWithdrawal.ChangeCommitment.Sign() != 0 {
		t.Fatal("the maximum full withdrawal created change")
	}
	if err := test.IsSolved(&circuit.WithdrawV2{}, fullWithdrawal.Assignment, ecc.BN254.ScalarField()); err != nil {
		t.Fatal(err)
	}
	for _, amount := range []string{"0", "18446744073709551616"} {
		if _, err := BuildWithdrawalV2(WithdrawalRequestV2{
			Context: v2Context, Payer: v2Payer, Recipient: v2Payer, SpendKey: "9001",
			Input: input, Amount: amount, ChangeBlinding: "8004",
		}); err == nil {
			t.Fatalf("withdrawal amount %s was accepted", amount)
		}
	}
}

func spendInputV2(t *testing.T, note NoteV2, leaves []*big.Int, leafIndex uint64) SpendInputV2 {
	t.Helper()
	witness, err := model.MerkleWitnessForLeavesV2(leaves, leafIndex)
	if err != nil {
		t.Fatal(err)
	}
	input := SpendInputV2{Note: note, SpendRoot: witness.Root.String()}
	for index := 0; index < model.TreeDepthV2; index++ {
		input.PathSiblings[index] = witness.Siblings[index].String()
		input.PathBits[index] = witness.Bits[index]
	}
	return input
}
