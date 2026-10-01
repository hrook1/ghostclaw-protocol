package circuit_test

import (
	"math/big"
	"testing"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/scs"
	"github.com/consensys/gnark/test"

	"github.com/hrook1/ghostclaw-confidential-payments/internal/circuit"
	"github.com/hrook1/ghostclaw-confidential-payments/internal/model"
)

type v2Scenario struct {
	identity *circuit.IdentityV2
	deposit  *circuit.DepositV2
	spend    *circuit.SpendV2
	withdraw *circuit.WithdrawV2
}

func TestV2CircuitsSolveWithLargeTreeMembership(t *testing.T) {
	assignments := buildV2Scenario(t)
	for _, item := range []struct {
		name       string
		definition frontend.Circuit
		witness    frontend.Circuit
	}{
		{"identity", &circuit.IdentityV2{}, assignments.identity},
		{"deposit", &circuit.DepositV2{}, assignments.deposit},
		{"spend", &circuit.SpendV2{}, assignments.spend},
		{"withdraw", &circuit.WithdrawV2{}, assignments.withdraw},
	} {
		t.Run(item.name, func(t *testing.T) {
			if err := test.IsSolved(item.definition, item.witness, ecc.BN254.ScalarField()); err != nil {
				t.Fatal(err)
			}
			compiled, err := frontend.Compile(ecc.BN254.ScalarField(), scs.NewBuilder, item.definition)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("%s constraints=%d public=%d", item.name, compiled.GetNbConstraints(), compiled.GetNbPublicVariables())
		})
	}
}

func TestV2SpendRejectsWrongMerklePath(t *testing.T) {
	assignments := buildV2Scenario(t)
	invalid := *assignments.spend
	invalid.PathSiblings[7] = big.NewInt(123)
	if err := test.IsSolved(&circuit.SpendV2{}, &invalid, ecc.BN254.ScalarField()); err == nil {
		t.Fatal("the v2 spend circuit accepted a changed Merkle path")
	}
}

func TestV2SpendRejectsChangedOutputRole(t *testing.T) {
	assignments := buildV2Scenario(t)
	invalid := *assignments.spend
	invalid.RecipientIsLeft = 0
	if err := test.IsSolved(&circuit.SpendV2{}, &invalid, ecc.BN254.ScalarField()); err == nil {
		t.Fatal("the v2 spend circuit accepted changed public output roles")
	}
}

func TestV2IdentityBindsAccountActionAndNonce(t *testing.T) {
	assignments := buildV2Scenario(t)
	for _, change := range []func(*circuit.IdentityV2){
		func(value *circuit.IdentityV2) { value.Account = big.NewInt(99) },
		func(value *circuit.IdentityV2) { value.Action = big.NewInt(2) },
		func(value *circuit.IdentityV2) { value.Nonce = big.NewInt(1) },
	} {
		invalid := *assignments.identity
		change(&invalid)
		if err := test.IsSolved(&circuit.IdentityV2{}, &invalid, ecc.BN254.ScalarField()); err == nil {
			t.Fatal("the v2 identity circuit accepted changed action data")
		}
	}
}

func TestV2WithdrawalBindsPayerRecipientAndAmount(t *testing.T) {
	assignments := buildV2Scenario(t)
	for _, change := range []func(*circuit.WithdrawV2){
		func(value *circuit.WithdrawV2) { value.Payer = big.NewInt(99) },
		func(value *circuit.WithdrawV2) { value.Recipient = big.NewInt(99) },
		func(value *circuit.WithdrawV2) { value.Amount = big.NewInt(1) },
	} {
		invalid := *assignments.withdraw
		change(&invalid)
		if err := test.IsSolved(&circuit.WithdrawV2{}, &invalid, ecc.BN254.ScalarField()); err == nil {
			t.Fatal("the v2 withdrawal circuit accepted changed authorization data")
		}
	}
}

func buildV2Scenario(t *testing.T) v2Scenario {
	t.Helper()
	context := mustBig("97433442488726861213578988847752201310395502865")
	payer := mustBig("194866884977453722427157977695504402620791005730")
	merchant := mustBig("292300327466180583640736966543256603931186508595")
	payerKey := big.NewInt(4097)
	merchantKey := big.NewInt(4098)
	payerOwner := model.OwnerV2(context, payerKey)
	merchantOwner := model.OwnerV2(context, merchantKey)
	depositAmount := big.NewInt(100_000_000)
	paymentAmount := big.NewInt(25_000_000)
	changeAmount := big.NewInt(75_000_000)
	withdrawAmount := big.NewInt(10_000_000)
	depositBlind := big.NewInt(8193)
	recipientBlind := big.NewInt(8194)
	changeBlind := big.NewInt(8195)
	withdrawBlind := big.NewInt(8196)
	requestDigest := big.NewInt(12289)

	depositCommitment := model.Note(context, depositAmount, payerOwner, depositBlind)
	recipientCommitment := model.Note(context, paymentAmount, merchantOwner, recipientBlind)
	changeCommitment := model.Note(context, changeAmount, payerOwner, changeBlind)
	withdrawCommitment := model.Note(context, big.NewInt(65_000_000), payerOwner, withdrawBlind)

	depositRoot, depositSiblings, depositBits := rootAndPathForSingleLeaf(depositCommitment)
	paymentRoot, changeSiblings, changeBits := rootAndPathForFourLeaves(
		depositCommitment,
		big.NewInt(0),
		recipientCommitment,
		changeCommitment,
		3,
	)

	identityAction := model.IdentityActionV2(context, payerOwner, payer, big.NewInt(1), big.NewInt(0))
	return v2Scenario{
		identity: &circuit.IdentityV2{
			Context:      context,
			Owner:        payerOwner,
			ActionDigest: identityAction,
			SpendKey:     payerKey,
			Account:      payer,
			Action:       1,
			Nonce:        0,
		},
		deposit: &circuit.DepositV2{
			Context:    context,
			Commitment: depositCommitment,
			Amount:     depositAmount,
			Owner:      payerOwner,
			SpendKey:   payerKey,
			Blinding:   depositBlind,
		},
		spend: &circuit.SpendV2{
			Context:           context,
			SpendRoot:         depositRoot,
			Nullifier:         model.Nullifier(context, payerKey, depositCommitment),
			OutputLeft:        recipientCommitment,
			OutputRight:       changeCommitment,
			SenderOwner:       payerOwner,
			RecipientOwner:    merchantOwner,
			PaymentIntent:     model.PaymentIntent(context, requestDigest, paymentAmount, payerOwner, merchantOwner, payer, merchant),
			Payer:             payer,
			Merchant:          merchant,
			InputAmount:       depositAmount,
			SpendKey:          payerKey,
			InputBlinding:     depositBlind,
			PathSiblings:      depositSiblings,
			PathBits:          depositBits,
			PaymentAmount:     paymentAmount,
			RecipientBlinding: recipientBlind,
			ChangeBlinding:    changeBlind,
			RecipientIsLeft:   1,
			RequestDigest:     requestDigest,
		},
		withdraw: &circuit.WithdrawV2{
			Context:          context,
			SpendRoot:        paymentRoot,
			Nullifier:        model.Nullifier(context, payerKey, changeCommitment),
			ChangeCommitment: withdrawCommitment,
			Owner:            payerOwner,
			ActionDigest:     model.WithdrawalActionV2(context, payerOwner, payer, payer, withdrawAmount),
			Payer:            payer,
			Recipient:        payer,
			Amount:           withdrawAmount,
			InputAmount:      changeAmount,
			SpendKey:         payerKey,
			InputBlinding:    changeBlind,
			PathSiblings:     changeSiblings,
			PathBits:         changeBits,
			ChangeBlinding:   withdrawBlind,
		},
	}
}

func rootAndPathForSingleLeaf(commitment *big.Int) (*big.Int, [circuit.TreeDepthV2]frontend.Variable, [circuit.TreeDepthV2]frontend.Variable) {
	var siblings [circuit.TreeDepthV2]frontend.Variable
	var bits [circuit.TreeDepthV2]frontend.Variable
	zeros := zeroRoots()
	current := new(big.Int).Set(commitment)
	for level := 0; level < circuit.TreeDepthV2; level++ {
		siblings[level] = zeros[level]
		bits[level] = 0
		current = model.MustTree(current, zeros[level])
	}
	return current, siblings, bits
}

func rootAndPathForFourLeaves(
	leaves0, leaves1, leaves2, leaves3 *big.Int,
	index int,
) (*big.Int, [circuit.TreeDepthV2]frontend.Variable, [circuit.TreeDepthV2]frontend.Variable) {
	var siblings [circuit.TreeDepthV2]frontend.Variable
	var bits [circuit.TreeDepthV2]frontend.Variable
	zeros := zeroRoots()
	pair0 := model.MustTree(leaves0, leaves1)
	pair1 := model.MustTree(leaves2, leaves3)
	current := []*big.Int{leaves0, leaves1, leaves2, leaves3}[index]
	siblings[0] = []*big.Int{leaves1, leaves0, leaves3, leaves2}[index]
	bits[0] = index & 1
	current = model.MustTree(
		selectBig(index&1 == 1, siblings[0].(*big.Int), current),
		selectBig(index&1 == 1, current, siblings[0].(*big.Int)),
	)
	siblings[1] = selectBig(index >= 2, pair0, pair1)
	bits[1] = (index >> 1) & 1
	if index >= 2 {
		current = model.MustTree(pair0, current)
	} else {
		current = model.MustTree(current, pair1)
	}
	for level := 2; level < circuit.TreeDepthV2; level++ {
		siblings[level] = zeros[level]
		bits[level] = 0
		current = model.MustTree(current, zeros[level])
	}
	return current, siblings, bits
}

func zeroRoots() [circuit.TreeDepthV2]*big.Int {
	var roots [circuit.TreeDepthV2]*big.Int
	roots[0] = big.NewInt(0)
	for level := 1; level < circuit.TreeDepthV2; level++ {
		roots[level] = model.MustTree(roots[level-1], roots[level-1])
	}
	return roots
}

func selectBig(condition bool, yes, no frontend.Variable) *big.Int {
	if condition {
		return yes.(*big.Int)
	}
	return no.(*big.Int)
}

func mustBig(value string) *big.Int {
	result, ok := new(big.Int).SetString(value, 10)
	if !ok {
		panic("invalid test integer")
	}
	return result
}
