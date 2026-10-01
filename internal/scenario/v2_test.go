package scenario

import (
	"fmt"
	"math/big"
	"testing"

	"github.com/hrook1/ghostclaw-confidential-payments/internal/model"
)

func TestBuildV2BindsTheSuppliedRequestDigest(t *testing.T) {
	first, err := BuildV2(
		"0x1111111111111111111111111111111111111111",
		"0x2222222222222222222222222222222222222222",
		"0x3333333333333333333333333333333333333333",
		"0x3001",
	)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildV2(
		"0x1111111111111111111111111111111111111111",
		"0x2222222222222222222222222222222222222222",
		"0x3333333333333333333333333333333333333333",
		"0x3002",
	)
	if err != nil {
		t.Fatal(err)
	}
	if first.Values.PaymentIntent.Cmp(second.Values.PaymentIntent) == 0 {
		t.Fatal("different x402 request digests produced the same payment intent")
	}
}

func TestBuildV2RejectsAnOutOfFieldRequestDigest(t *testing.T) {
	_, err := BuildV2(
		"0x1111111111111111111111111111111111111111",
		"0x2222222222222222222222222222222222222222",
		"0x3333333333333333333333333333333333333333",
		fmt.Sprintf("0x%x", model.ScalarFieldModulus),
	)
	if err == nil {
		t.Fatal("an out-of-field x402 request digest was accepted")
	}
}

func TestBuildV2WithKeysCreatesFreshOwners(t *testing.T) {
	first, err := BuildV2WithKeys(
		"0x1111111111111111111111111111111111111111",
		"0x2222222222222222222222222222222222222222",
		"0x3333333333333333333333333333333333333333",
		"0x3001",
		"0x4001",
		"0x4002",
	)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildV2WithKeys(
		"0x1111111111111111111111111111111111111111",
		"0x2222222222222222222222222222222222222222",
		"0x3333333333333333333333333333333333333333",
		"0x3001",
		"0x5001",
		"0x5002",
	)
	if err != nil {
		t.Fatal(err)
	}
	if first.Values.PayerOwner.Cmp(second.Values.PayerOwner) == 0 {
		t.Fatal("fresh payer spend keys produced the same owner")
	}
	if first.Values.MerchantOwner.Cmp(second.Values.MerchantOwner) == 0 {
		t.Fatal("fresh merchant spend keys produced the same owner")
	}
}

func TestBuildV2WithStateUsesExistingLeaves(t *testing.T) {
	first, err := BuildV2WithState(
		"0x1111111111111111111111111111111111111111",
		"0x2222222222222222222222222222222222222222",
		"0x3333333333333333333333333333333333333333",
		"0x3001",
		"0x4001",
		"0x4002",
		[]*big.Int{model.Int(0x7001), model.Int(0x7002)},
	)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildV2WithKeys(
		"0x1111111111111111111111111111111111111111",
		"0x2222222222222222222222222222222222222222",
		"0x3333333333333333333333333333333333333333",
		"0x3001",
		"0x4001",
		"0x4002",
	)
	if err != nil {
		t.Fatal(err)
	}
	if first.Values.DepositRoot.Cmp(second.Values.DepositRoot) == 0 {
		t.Fatal("existing leaves did not change the deposit root")
	}
	if first.Values.PaymentRoot.Cmp(second.Values.PaymentRoot) == 0 {
		t.Fatal("existing leaves did not change the payment root")
	}
}
