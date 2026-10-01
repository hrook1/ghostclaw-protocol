package scenario

import (
	"fmt"
	"math/big"

	"github.com/consensys/gnark/frontend"

	"github.com/hrook1/ghostclaw-confidential-payments/internal/circuit"
	"github.com/hrook1/ghostclaw-confidential-payments/internal/model"
)

type AssignmentsV2 struct {
	IdentityPayer    *circuit.IdentityV2
	IdentityMerchant *circuit.IdentityV2
	Deposit          *circuit.DepositV2
	Spend            *circuit.SpendV2
	Withdraw         *circuit.WithdrawV2
	Values           ValuesV2
}

type ValuesV2 struct {
	Context              *big.Int
	Payer                *big.Int
	Merchant             *big.Int
	PayerOwner           *big.Int
	MerchantOwner        *big.Int
	DepositCommitment    *big.Int
	DepositRoot          *big.Int
	RecipientCommitment  *big.Int
	ChangeCommitment     *big.Int
	OutputLeft           *big.Int
	OutputRight          *big.Int
	PaymentRoot          *big.Int
	SpendNullifier       *big.Int
	PaymentIntent        *big.Int
	WithdrawalNullifier  *big.Int
	WithdrawalCommitment *big.Int
	WithdrawalAction     *big.Int
}

func BuildV2(contextHex, payerHex, merchantHex, requestDigestHex string) (AssignmentsV2, error) {
	return BuildV2WithKeys(
		contextHex,
		payerHex,
		merchantHex,
		requestDigestHex,
		"0x1001",
		"0x1002",
	)
}

func BuildV2WithKeys(
	contextHex,
	payerHex,
	merchantHex,
	requestDigestHex,
	payerKeyHex,
	merchantKeyHex string,
) (AssignmentsV2, error) {
	return BuildV2WithState(
		contextHex,
		payerHex,
		merchantHex,
		requestDigestHex,
		payerKeyHex,
		merchantKeyHex,
		nil,
	)
}

func BuildV2WithState(
	contextHex,
	payerHex,
	merchantHex,
	requestDigestHex,
	payerKeyHex,
	merchantKeyHex string,
	existingLeaves []*big.Int,
) (AssignmentsV2, error) {
	context, err := ParseHex(contextHex, 160)
	if err != nil {
		return AssignmentsV2{}, fmt.Errorf("context: %w", err)
	}
	payer, err := ParseHex(payerHex, 160)
	if err != nil {
		return AssignmentsV2{}, fmt.Errorf("payer: %w", err)
	}
	merchant, err := ParseHex(merchantHex, 160)
	if err != nil {
		return AssignmentsV2{}, fmt.Errorf("merchant: %w", err)
	}
	requestDigest, err := ParseHex(requestDigestHex, 256)
	if err != nil || requestDigest.Sign() == 0 || requestDigest.Cmp(model.ScalarFieldModulus) >= 0 {
		return AssignmentsV2{}, fmt.Errorf("request digest: invalid BN254 field value")
	}
	payerKey, err := ParseHex(payerKeyHex, 256)
	if err != nil || payerKey.Sign() == 0 || payerKey.Cmp(model.ScalarFieldModulus) >= 0 {
		return AssignmentsV2{}, fmt.Errorf("payer spend key: invalid BN254 field value")
	}
	merchantKey, err := ParseHex(merchantKeyHex, 256)
	if err != nil || merchantKey.Sign() == 0 || merchantKey.Cmp(model.ScalarFieldModulus) >= 0 {
		return AssignmentsV2{}, fmt.Errorf("merchant spend key: invalid BN254 field value")
	}
	if payerKey.Cmp(merchantKey) == 0 {
		return AssignmentsV2{}, fmt.Errorf("payer and merchant spend keys must differ")
	}
	if len(existingLeaves)%2 != 0 || len(existingLeaves)+4 > 1<<model.TreeDepthV2 {
		return AssignmentsV2{}, fmt.Errorf("existing leaves: invalid pair count")
	}
	prefixLeaves := make([]*big.Int, len(existingLeaves))
	for index, leaf := range existingLeaves {
		if leaf == nil || leaf.Sign() < 0 || leaf.Cmp(model.ScalarFieldModulus) >= 0 {
			return AssignmentsV2{}, fmt.Errorf("existing leaf %d: invalid BN254 field value", index)
		}
		prefixLeaves[index] = new(big.Int).Set(leaf)
	}

	payerOwner := model.OwnerV2(context, payerKey)
	merchantOwner := model.OwnerV2(context, merchantKey)
	depositAmount := model.Int(DepositAmount)
	paymentAmount := model.Int(PaymentAmount)
	changeAmount := model.Int(DepositAmount - PaymentAmount)
	withdrawalAmount := model.Int(WithdrawalAmount)
	depositBlind := model.Int(0x2001)
	recipientBlind := model.Int(0x2002)
	changeBlind := model.Int(0x2003)
	withdrawalBlind := model.Int(0x2004)

	depositCommitment := model.Note(context, depositAmount, payerOwner, depositBlind)
	recipientCommitment := model.Note(context, paymentAmount, merchantOwner, recipientBlind)
	changeCommitment := model.Note(context, changeAmount, payerOwner, changeBlind)
	withdrawalCommitment := model.Note(
		context,
		model.Int(DepositAmount-PaymentAmount-WithdrawalAmount),
		payerOwner,
		withdrawalBlind,
	)
	depositLeaves := append(prefixLeaves, depositCommitment, big.NewInt(0))
	depositWitness, err := model.MerkleWitnessForLeavesV2(depositLeaves, uint64(len(prefixLeaves)))
	if err != nil {
		return AssignmentsV2{}, err
	}
	paymentLeaves := append(depositLeaves, recipientCommitment, changeCommitment)
	paymentWitness, err := model.MerkleWitnessForLeavesV2(paymentLeaves, uint64(len(prefixLeaves)+3))
	if err != nil {
		return AssignmentsV2{}, err
	}
	depositSiblings, depositBits := circuitWitness(depositWitness)
	paymentSiblings, paymentBits := circuitWitness(paymentWitness)

	spendNullifier := model.Nullifier(context, payerKey, depositCommitment)
	paymentIntent := model.PaymentIntent(
		context,
		requestDigest,
		paymentAmount,
		payerOwner,
		merchantOwner,
		payer,
		merchant,
	)
	withdrawalNullifier := model.Nullifier(context, payerKey, changeCommitment)
	withdrawalAction := model.WithdrawalActionV2(context, payerOwner, payer, payer, withdrawalAmount)
	return AssignmentsV2{
		IdentityPayer: &circuit.IdentityV2{
			Context:      context,
			Owner:        payerOwner,
			ActionDigest: model.IdentityActionV2(context, payerOwner, payer, model.Int(1), model.Int(0)),
			SpendKey:     payerKey,
			Account:      payer,
			Action:       1,
			Nonce:        0,
		},
		IdentityMerchant: &circuit.IdentityV2{
			Context:      context,
			Owner:        merchantOwner,
			ActionDigest: model.IdentityActionV2(context, merchantOwner, merchant, model.Int(1), model.Int(0)),
			SpendKey:     merchantKey,
			Account:      merchant,
			Action:       1,
			Nonce:        0,
		},
		Deposit: &circuit.DepositV2{
			Context:    context,
			Commitment: depositCommitment,
			Amount:     depositAmount,
			Owner:      payerOwner,
			SpendKey:   payerKey,
			Blinding:   depositBlind,
		},
		Spend: &circuit.SpendV2{
			Context:           context,
			SpendRoot:         depositWitness.Root,
			Nullifier:         spendNullifier,
			OutputLeft:        recipientCommitment,
			OutputRight:       changeCommitment,
			SenderOwner:       payerOwner,
			RecipientOwner:    merchantOwner,
			PaymentIntent:     paymentIntent,
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
		Withdraw: &circuit.WithdrawV2{
			Context:          context,
			SpendRoot:        paymentWitness.Root,
			Nullifier:        withdrawalNullifier,
			ChangeCommitment: withdrawalCommitment,
			Owner:            payerOwner,
			ActionDigest:     withdrawalAction,
			Amount:           withdrawalAmount,
			InputAmount:      changeAmount,
			SpendKey:         payerKey,
			Payer:            payer,
			Recipient:        payer,
			InputBlinding:    changeBlind,
			PathSiblings:     paymentSiblings,
			PathBits:         paymentBits,
			ChangeBlinding:   withdrawalBlind,
		},
		Values: ValuesV2{
			Context:              context,
			Payer:                payer,
			Merchant:             merchant,
			PayerOwner:           payerOwner,
			MerchantOwner:        merchantOwner,
			DepositCommitment:    depositCommitment,
			DepositRoot:          depositWitness.Root,
			RecipientCommitment:  recipientCommitment,
			ChangeCommitment:     changeCommitment,
			OutputLeft:           recipientCommitment,
			OutputRight:          changeCommitment,
			PaymentRoot:          paymentWitness.Root,
			SpendNullifier:       spendNullifier,
			PaymentIntent:        paymentIntent,
			WithdrawalNullifier:  withdrawalNullifier,
			WithdrawalCommitment: withdrawalCommitment,
			WithdrawalAction:     withdrawalAction,
		},
	}, nil
}

func circuitWitness(witness model.MerkleWitnessV2) (
	[model.TreeDepthV2]frontend.Variable,
	[model.TreeDepthV2]frontend.Variable,
) {
	var siblings [model.TreeDepthV2]frontend.Variable
	var bits [model.TreeDepthV2]frontend.Variable
	for index := 0; index < model.TreeDepthV2; index++ {
		siblings[index] = witness.Siblings[index]
		bits[index] = witness.Bits[index]
	}
	return siblings, bits
}
