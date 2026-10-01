package operation

import (
	"fmt"
	"math/big"

	"github.com/consensys/gnark/frontend"

	"github.com/hrook1/ghostclaw-confidential-payments/internal/circuit"
	"github.com/hrook1/ghostclaw-confidential-payments/internal/model"
)

type NoteV2 struct {
	Amount         string `json:"amount"`
	Owner          string `json:"owner"`
	Blinding       string `json:"blinding"`
	Commitment     string `json:"commitment"`
	OutputPosition uint8  `json:"outputPosition"`
}

type SpendInputV2 struct {
	Note         NoteV2                    `json:"note"`
	SpendRoot    string                    `json:"spendRoot"`
	PathSiblings [model.TreeDepthV2]string `json:"pathSiblings"`
	PathBits     [model.TreeDepthV2]uint8  `json:"pathBits"`
}

type IdentityRequestV2 struct {
	Context  string `json:"context"`
	SpendKey string `json:"spendKey"`
	Account  string `json:"account"`
	Action   string `json:"action"`
	Nonce    string `json:"nonce"`
}

type DepositRequestV2 struct {
	Context  string `json:"context"`
	SpendKey string `json:"spendKey"`
	Amount   string `json:"amount"`
	Blinding string `json:"blinding"`
}

type PaymentRequestV2 struct {
	Context           string       `json:"context"`
	Payer             string       `json:"payer"`
	Merchant          string       `json:"merchant"`
	RecipientOwner    string       `json:"recipientOwner"`
	RequestDigest     string       `json:"requestDigest"`
	SpendKey          string       `json:"spendKey"`
	Input             SpendInputV2 `json:"input"`
	PaymentAmount     string       `json:"paymentAmount"`
	RecipientBlinding string       `json:"recipientBlinding"`
	ChangeBlinding    string       `json:"changeBlinding"`
	RecipientIsLeft   uint8        `json:"recipientIsLeft"`
}

type WithdrawalRequestV2 struct {
	Context        string       `json:"context"`
	Payer          string       `json:"payer"`
	Recipient      string       `json:"recipient"`
	SpendKey       string       `json:"spendKey"`
	Input          SpendInputV2 `json:"input"`
	Amount         string       `json:"amount"`
	ChangeBlinding string       `json:"changeBlinding"`
}

type ReceivedPaymentRequestV2 struct {
	Context        string `json:"context"`
	Payer          string `json:"payer"`
	Merchant       string `json:"merchant"`
	SenderOwner    string `json:"senderOwner"`
	RecipientOwner string `json:"recipientOwner"`
	RequestDigest  string `json:"requestDigest"`
	OutputLeft     string `json:"outputLeft"`
	OutputRight    string `json:"outputRight"`
	Note           NoteV2 `json:"note"`
}

type IdentityResultV2 struct {
	Assignment   *circuit.IdentityV2
	Owner        *big.Int
	ActionDigest *big.Int
}

type DepositResultV2 struct {
	Assignment *circuit.DepositV2
	Owner      *big.Int
	Commitment *big.Int
	Note       NoteV2
}

type PaymentResultV2 struct {
	Assignment          *circuit.SpendV2
	SenderOwner         *big.Int
	Nullifier           *big.Int
	OutputLeft          *big.Int
	OutputRight         *big.Int
	RecipientCommitment *big.Int
	ChangeCommitment    *big.Int
	PaymentIntent       *big.Int
	RecipientNote       NoteV2
	ChangeNote          NoteV2
}

type WithdrawalResultV2 struct {
	Assignment       *circuit.WithdrawV2
	Owner            *big.Int
	ActionDigest     *big.Int
	Nullifier        *big.Int
	ChangeCommitment *big.Int
	ChangeNote       *NoteV2
}

type ReceivedPaymentResultV2 struct {
	Amount              string `json:"amount"`
	RecipientCommitment string `json:"recipientCommitment"`
	SiblingCommitment   string `json:"siblingCommitment"`
	PaymentIntent       string `json:"paymentIntent"`
	OutputPosition      uint8  `json:"outputPosition"`
}

type TreeWitnessRequestV2 struct {
	Leaves    []string `json:"leaves"`
	LeafIndex uint64   `json:"leafIndex"`
}

type TreeWitnessResultV2 struct {
	Root         string                    `json:"root"`
	PathSiblings [model.TreeDepthV2]string `json:"pathSiblings"`
	PathBits     [model.TreeDepthV2]uint8  `json:"pathBits"`
}

func BuildTreeWitnessV2(request TreeWitnessRequestV2) (TreeWitnessResultV2, error) {
	leaves := make([]*big.Int, len(request.Leaves))
	for index, text := range request.Leaves {
		leaf, err := parseField(text, true)
		if err != nil {
			return TreeWitnessResultV2{}, fmt.Errorf("tree leaf %d: %w", index, err)
		}
		leaves[index] = leaf
	}
	witness, err := model.MerkleWitnessForLeavesV2(leaves, request.LeafIndex)
	if err != nil {
		return TreeWitnessResultV2{}, err
	}
	result := TreeWitnessResultV2{Root: witness.Root.String(), PathBits: witness.Bits}
	for index := 0; index < model.TreeDepthV2; index++ {
		result.PathSiblings[index] = witness.Siblings[index].String()
	}
	return result, nil
}

func DeriveOwnerV2(contextText, spendKeyText string) (*big.Int, error) {
	context, err := parseAddress(contextText)
	if err != nil {
		return nil, fmt.Errorf("context: %w", err)
	}
	spendKey, err := parseField(spendKeyText, false)
	if err != nil {
		return nil, fmt.Errorf("spend key: %w", err)
	}
	return model.OwnerV2(context, spendKey), nil
}

func BuildIdentityV2(request IdentityRequestV2) (IdentityResultV2, error) {
	context, err := parseAddress(request.Context)
	if err != nil {
		return IdentityResultV2{}, fmt.Errorf("context: %w", err)
	}
	spendKey, err := parseField(request.SpendKey, false)
	if err != nil {
		return IdentityResultV2{}, fmt.Errorf("spend key: %w", err)
	}
	account, err := parseAddress(request.Account)
	if err != nil {
		return IdentityResultV2{}, fmt.Errorf("account: %w", err)
	}
	action, err := parseField(request.Action, false)
	if err != nil || action.Cmp(big.NewInt(3)) > 0 {
		return IdentityResultV2{}, fmt.Errorf("identity action must be 1, 2, or 3")
	}
	nonce, err := parseField(request.Nonce, true)
	if err != nil {
		return IdentityResultV2{}, fmt.Errorf("identity nonce: %w", err)
	}
	owner := model.OwnerV2(context, spendKey)
	actionDigest := model.IdentityActionV2(context, owner, account, action, nonce)
	return IdentityResultV2{
		Assignment: &circuit.IdentityV2{
			Context:      context,
			Owner:        owner,
			ActionDigest: actionDigest,
			SpendKey:     spendKey,
			Account:      account,
			Action:       action,
			Nonce:        nonce,
		},
		Owner:        owner,
		ActionDigest: actionDigest,
	}, nil
}

func BuildDepositV2(request DepositRequestV2) (DepositResultV2, error) {
	context, err := parseAddress(request.Context)
	if err != nil {
		return DepositResultV2{}, fmt.Errorf("context: %w", err)
	}
	spendKey, err := parseField(request.SpendKey, false)
	if err != nil {
		return DepositResultV2{}, fmt.Errorf("spend key: %w", err)
	}
	amount, err := parseUint64(request.Amount, false)
	if err != nil {
		return DepositResultV2{}, fmt.Errorf("amount: %w", err)
	}
	blinding, err := parseField(request.Blinding, false)
	if err != nil {
		return DepositResultV2{}, fmt.Errorf("blinding: %w", err)
	}
	owner := model.OwnerV2(context, spendKey)
	commitment := model.Note(context, amount, owner, blinding)
	note := newNoteV2(amount, owner, blinding, commitment, 0)
	return DepositResultV2{
		Assignment: &circuit.DepositV2{
			Context:    context,
			Commitment: commitment,
			Amount:     amount,
			Owner:      owner,
			SpendKey:   spendKey,
			Blinding:   blinding,
		},
		Owner: owner, Commitment: commitment, Note: note,
	}, nil
}

func BuildPaymentV2(request PaymentRequestV2) (PaymentResultV2, error) {
	context, payer, merchant, recipientOwner, requestDigest, err := parsePaymentPublicV2(request)
	if err != nil {
		return PaymentResultV2{}, err
	}
	spendKey, inputAmount, inputBlinding, spendRoot, siblings, bits, err := parseSpendInputV2(
		request.SpendKey,
		request.Input,
	)
	if err != nil {
		return PaymentResultV2{}, err
	}
	paymentAmount, err := parseUint64(request.PaymentAmount, false)
	if err != nil {
		return PaymentResultV2{}, fmt.Errorf("payment amount: %w", err)
	}
	if paymentAmount.Cmp(inputAmount) >= 0 {
		return PaymentResultV2{}, fmt.Errorf("payment amount must be less than the input amount")
	}
	if request.RecipientIsLeft > 1 {
		return PaymentResultV2{}, fmt.Errorf("recipient output position must be zero or one")
	}
	recipientBlinding, err := parseField(request.RecipientBlinding, false)
	if err != nil {
		return PaymentResultV2{}, fmt.Errorf("recipient blinding: %w", err)
	}
	changeBlinding, err := parseField(request.ChangeBlinding, false)
	if err != nil {
		return PaymentResultV2{}, fmt.Errorf("change blinding: %w", err)
	}

	senderOwner := model.OwnerV2(context, spendKey)
	inputCommitment := model.Note(context, inputAmount, senderOwner, inputBlinding)
	if err := checkInputCommitment(request.Input.Note.Commitment, inputCommitment); err != nil {
		return PaymentResultV2{}, err
	}
	if request.Input.Note.Owner != "" {
		inputOwner, parseErr := parseField(request.Input.Note.Owner, false)
		if parseErr != nil || inputOwner.Cmp(senderOwner) != 0 {
			return PaymentResultV2{}, fmt.Errorf("input owner does not match the spend key")
		}
	}
	witness := model.MerkleWitnessV2{Root: spendRoot, Siblings: siblings, Bits: bits}
	calculatedRoot, err := model.RootFromWitnessV2(inputCommitment, witness)
	if err != nil || calculatedRoot.Cmp(spendRoot) != 0 {
		return PaymentResultV2{}, fmt.Errorf("input membership data does not match the spend root")
	}

	changeAmount := new(big.Int).Sub(inputAmount, paymentAmount)
	recipientCommitment := model.Note(context, paymentAmount, recipientOwner, recipientBlinding)
	changeCommitment := model.Note(context, changeAmount, senderOwner, changeBlinding)
	outputLeft, outputRight := changeCommitment, recipientCommitment
	if request.RecipientIsLeft == 1 {
		outputLeft, outputRight = recipientCommitment, changeCommitment
	}
	nullifier := model.Nullifier(context, spendKey, inputCommitment)
	paymentIntent := model.PaymentIntent(
		context,
		requestDigest,
		paymentAmount,
		senderOwner,
		recipientOwner,
		payer,
		merchant,
	)
	circuitSiblings, circuitBits := witnessVariablesV2(siblings, bits)
	return PaymentResultV2{
		Assignment: &circuit.SpendV2{
			Context: context, SpendRoot: spendRoot, Nullifier: nullifier,
			OutputLeft: outputLeft, OutputRight: outputRight,
			SenderOwner: senderOwner, RecipientOwner: recipientOwner,
			PaymentIntent: paymentIntent, Payer: payer, Merchant: merchant,
			InputAmount: inputAmount, SpendKey: spendKey, InputBlinding: inputBlinding,
			PathSiblings: circuitSiblings, PathBits: circuitBits,
			PaymentAmount: paymentAmount, RecipientBlinding: recipientBlinding,
			ChangeBlinding: changeBlinding, RecipientIsLeft: request.RecipientIsLeft,
			RequestDigest: requestDigest,
		},
		SenderOwner: senderOwner, Nullifier: nullifier,
		OutputLeft: outputLeft, OutputRight: outputRight,
		RecipientCommitment: recipientCommitment, ChangeCommitment: changeCommitment,
		PaymentIntent: paymentIntent,
		RecipientNote: newNoteV2(
			paymentAmount, recipientOwner, recipientBlinding, recipientCommitment, 1-request.RecipientIsLeft,
		),
		ChangeNote: newNoteV2(
			changeAmount, senderOwner, changeBlinding, changeCommitment, request.RecipientIsLeft,
		),
	}, nil
}

func BuildWithdrawalV2(request WithdrawalRequestV2) (WithdrawalResultV2, error) {
	context, err := parseAddress(request.Context)
	if err != nil {
		return WithdrawalResultV2{}, fmt.Errorf("context: %w", err)
	}
	payer, err := parseAddress(request.Payer)
	if err != nil {
		return WithdrawalResultV2{}, fmt.Errorf("payer: %w", err)
	}
	recipient, err := parseAddress(request.Recipient)
	if err != nil {
		return WithdrawalResultV2{}, fmt.Errorf("recipient: %w", err)
	}
	spendKey, inputAmount, inputBlinding, spendRoot, siblings, bits, err := parseSpendInputV2(
		request.SpendKey,
		request.Input,
	)
	if err != nil {
		return WithdrawalResultV2{}, err
	}
	amount, err := parseUint64(request.Amount, false)
	if err != nil {
		return WithdrawalResultV2{}, fmt.Errorf("amount: %w", err)
	}
	if amount.Cmp(inputAmount) > 0 {
		return WithdrawalResultV2{}, fmt.Errorf("withdrawal amount must not exceed the input amount")
	}
	changeBlinding, err := parseField(request.ChangeBlinding, false)
	if err != nil {
		return WithdrawalResultV2{}, fmt.Errorf("change blinding: %w", err)
	}
	owner := model.OwnerV2(context, spendKey)
	inputCommitment := model.Note(context, inputAmount, owner, inputBlinding)
	if err := checkInputCommitment(request.Input.Note.Commitment, inputCommitment); err != nil {
		return WithdrawalResultV2{}, err
	}
	if request.Input.Note.Owner != "" {
		inputOwner, parseErr := parseField(request.Input.Note.Owner, false)
		if parseErr != nil || inputOwner.Cmp(owner) != 0 {
			return WithdrawalResultV2{}, fmt.Errorf("input owner does not match the spend key")
		}
	}
	witness := model.MerkleWitnessV2{Root: spendRoot, Siblings: siblings, Bits: bits}
	calculatedRoot, err := model.RootFromWitnessV2(inputCommitment, witness)
	if err != nil || calculatedRoot.Cmp(spendRoot) != 0 {
		return WithdrawalResultV2{}, fmt.Errorf("input membership data does not match the spend root")
	}
	changeAmount := new(big.Int).Sub(inputAmount, amount)
	changeCommitment := big.NewInt(0)
	var changeNote *NoteV2
	if changeAmount.Sign() != 0 {
		changeCommitment = model.Note(context, changeAmount, owner, changeBlinding)
		note := newNoteV2(changeAmount, owner, changeBlinding, changeCommitment, 0)
		changeNote = &note
	}
	nullifier := model.Nullifier(context, spendKey, inputCommitment)
	actionDigest := model.WithdrawalActionV2(context, owner, payer, recipient, amount)
	circuitSiblings, circuitBits := witnessVariablesV2(siblings, bits)
	return WithdrawalResultV2{
		Assignment: &circuit.WithdrawV2{
			Context: context, SpendRoot: spendRoot, Nullifier: nullifier,
			ChangeCommitment: changeCommitment, Owner: owner, ActionDigest: actionDigest,
			Amount: amount, InputAmount: inputAmount, Payer: payer, Recipient: recipient,
			SpendKey: spendKey, InputBlinding: inputBlinding,
			PathSiblings: circuitSiblings, PathBits: circuitBits, ChangeBlinding: changeBlinding,
		},
		Owner: owner, ActionDigest: actionDigest, Nullifier: nullifier, ChangeCommitment: changeCommitment,
		ChangeNote: changeNote,
	}, nil
}

func InspectReceivedPaymentV2(request ReceivedPaymentRequestV2) (ReceivedPaymentResultV2, error) {
	context, err := parseAddress(request.Context)
	if err != nil {
		return ReceivedPaymentResultV2{}, fmt.Errorf("context: %w", err)
	}
	payer, err := parseAddress(request.Payer)
	if err != nil {
		return ReceivedPaymentResultV2{}, fmt.Errorf("payer: %w", err)
	}
	merchant, err := parseAddress(request.Merchant)
	if err != nil {
		return ReceivedPaymentResultV2{}, fmt.Errorf("merchant: %w", err)
	}
	senderOwner, err := parseField(request.SenderOwner, false)
	if err != nil {
		return ReceivedPaymentResultV2{}, fmt.Errorf("sender owner: %w", err)
	}
	recipientOwner, err := parseField(request.RecipientOwner, false)
	if err != nil {
		return ReceivedPaymentResultV2{}, fmt.Errorf("recipient owner: %w", err)
	}
	requestDigest, err := parseField(request.RequestDigest, false)
	if err != nil {
		return ReceivedPaymentResultV2{}, fmt.Errorf("request digest: %w", err)
	}
	amount, err := parseUint64(request.Note.Amount, false)
	if err != nil {
		return ReceivedPaymentResultV2{}, fmt.Errorf("note amount: %w", err)
	}
	owner, err := parseField(request.Note.Owner, false)
	if err != nil || owner.Cmp(recipientOwner) != 0 {
		return ReceivedPaymentResultV2{}, fmt.Errorf("note owner does not match the recipient owner")
	}
	blinding, err := parseField(request.Note.Blinding, false)
	if err != nil {
		return ReceivedPaymentResultV2{}, fmt.Errorf("note blinding: %w", err)
	}
	if request.Note.OutputPosition > 1 {
		return ReceivedPaymentResultV2{}, fmt.Errorf("note output position must be zero or one")
	}
	outputLeft, err := parseField(request.OutputLeft, false)
	if err != nil {
		return ReceivedPaymentResultV2{}, fmt.Errorf("left output: %w", err)
	}
	outputRight, err := parseField(request.OutputRight, false)
	if err != nil {
		return ReceivedPaymentResultV2{}, fmt.Errorf("right output: %w", err)
	}
	recipientCommitment := model.Note(context, amount, recipientOwner, blinding)
	providedCommitment, err := parseField(request.Note.Commitment, false)
	if err != nil || providedCommitment.Cmp(recipientCommitment) != 0 {
		return ReceivedPaymentResultV2{}, fmt.Errorf("received note commitment does not match its private fields")
	}
	selected, sibling := outputLeft, outputRight
	if request.Note.OutputPosition == 1 {
		selected, sibling = outputRight, outputLeft
	}
	if selected.Cmp(recipientCommitment) != 0 {
		return ReceivedPaymentResultV2{}, fmt.Errorf("received note position does not match the public outputs")
	}
	paymentIntent := model.PaymentIntent(
		context, requestDigest, amount, senderOwner, recipientOwner, payer, merchant,
	)
	return ReceivedPaymentResultV2{
		Amount: amount.String(), RecipientCommitment: recipientCommitment.String(),
		SiblingCommitment: sibling.String(), PaymentIntent: paymentIntent.String(),
		OutputPosition: request.Note.OutputPosition,
	}, nil
}

func parsePaymentPublicV2(request PaymentRequestV2) (
	*big.Int, *big.Int, *big.Int, *big.Int, *big.Int, error,
) {
	context, err := parseAddress(request.Context)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("context: %w", err)
	}
	payer, err := parseAddress(request.Payer)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("payer: %w", err)
	}
	merchant, err := parseAddress(request.Merchant)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("merchant: %w", err)
	}
	recipientOwner, err := parseField(request.RecipientOwner, false)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("recipient owner: %w", err)
	}
	requestDigest, err := parseField(request.RequestDigest, false)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("request digest: %w", err)
	}
	return context, payer, merchant, recipientOwner, requestDigest, nil
}

func parseSpendInputV2(spendKeyText string, input SpendInputV2) (
	*big.Int, *big.Int, *big.Int, *big.Int,
	[model.TreeDepthV2]*big.Int, [model.TreeDepthV2]uint8, error,
) {
	var siblings [model.TreeDepthV2]*big.Int
	var bits [model.TreeDepthV2]uint8
	spendKey, err := parseField(spendKeyText, false)
	if err != nil {
		return nil, nil, nil, nil, siblings, bits, fmt.Errorf("spend key: %w", err)
	}
	amount, err := parseUint64(input.Note.Amount, false)
	if err != nil {
		return nil, nil, nil, nil, siblings, bits, fmt.Errorf("input amount: %w", err)
	}
	blinding, err := parseField(input.Note.Blinding, false)
	if err != nil {
		return nil, nil, nil, nil, siblings, bits, fmt.Errorf("input blinding: %w", err)
	}
	root, err := parseField(input.SpendRoot, false)
	if err != nil {
		return nil, nil, nil, nil, siblings, bits, fmt.Errorf("spend root: %w", err)
	}
	for index := 0; index < model.TreeDepthV2; index++ {
		siblings[index], err = parseField(input.PathSiblings[index], true)
		if err != nil {
			return nil, nil, nil, nil, siblings, bits, fmt.Errorf("path sibling %d: %w", index, err)
		}
		if input.PathBits[index] > 1 {
			return nil, nil, nil, nil, siblings, bits, fmt.Errorf("path bit %d must be zero or one", index)
		}
		bits[index] = input.PathBits[index]
	}
	return spendKey, amount, blinding, root, siblings, bits, nil
}

func witnessVariablesV2(
	siblings [model.TreeDepthV2]*big.Int,
	bits [model.TreeDepthV2]uint8,
) ([model.TreeDepthV2]frontend.Variable, [model.TreeDepthV2]frontend.Variable) {
	var circuitSiblings [model.TreeDepthV2]frontend.Variable
	var circuitBits [model.TreeDepthV2]frontend.Variable
	for index := 0; index < model.TreeDepthV2; index++ {
		circuitSiblings[index] = siblings[index]
		circuitBits[index] = bits[index]
	}
	return circuitSiblings, circuitBits
}

func newNoteV2(amount, owner, blinding, commitment *big.Int, outputPosition uint8) NoteV2 {
	return NoteV2{
		Amount: amount.String(), Owner: owner.String(), Blinding: blinding.String(),
		Commitment: commitment.String(), OutputPosition: outputPosition,
	}
}
