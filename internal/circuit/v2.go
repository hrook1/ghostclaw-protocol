package circuit

import (
	"github.com/consensys/gnark/frontend"
	stdposeidon2 "github.com/consensys/gnark/std/permutation/poseidon2"

	"github.com/hrook1/ghostclaw-confidential-payments/internal/model"
)

const TreeDepthV2 = 20

type IdentityV2 struct {
	Context      frontend.Variable `gnark:",public"`
	Owner        frontend.Variable `gnark:",public"`
	ActionDigest frontend.Variable `gnark:",public"`

	SpendKey frontend.Variable
	Account  frontend.Variable
	Action   frontend.Variable
	Nonce    frontend.Variable
}

func (c *IdentityV2) Define(api frontend.API) error {
	api.AssertIsEqual(c.Owner, ownerV2(api, c.Context, c.SpendKey))
	api.AssertIsEqual(
		c.ActionDigest,
		identityActionV2(api, c.Context, c.Owner, c.Account, c.Action, c.Nonce),
	)
	return nil
}

type DepositV2 struct {
	Context    frontend.Variable `gnark:",public"`
	Commitment frontend.Variable `gnark:",public"`
	Amount     frontend.Variable `gnark:",public"`
	Owner      frontend.Variable `gnark:",public"`

	SpendKey frontend.Variable
	Blinding frontend.Variable
}

func (c *DepositV2) Define(api frontend.API) error {
	range64(api, c.Amount)
	api.AssertIsDifferent(c.Amount, 0)
	api.AssertIsEqual(c.Owner, ownerV2(api, c.Context, c.SpendKey))
	api.AssertIsEqual(c.Commitment, hash(api, model.DomainNote, c.Context, c.Amount, c.Owner, c.Blinding))
	return nil
}

type SpendV2 struct {
	Context           frontend.Variable `gnark:",public"`
	SpendRoot         frontend.Variable `gnark:",public"`
	Nullifier         frontend.Variable `gnark:",public"`
	OutputLeft        frontend.Variable `gnark:",public"`
	OutputRight       frontend.Variable `gnark:",public"`
	SenderOwner       frontend.Variable `gnark:",public"`
	RecipientOwner    frontend.Variable `gnark:",public"`
	PaymentIntent     frontend.Variable `gnark:",public"`
	Payer             frontend.Variable `gnark:",public"`
	Merchant          frontend.Variable `gnark:",public"`
	InputAmount       frontend.Variable
	SpendKey          frontend.Variable
	InputBlinding     frontend.Variable
	PathSiblings      [TreeDepthV2]frontend.Variable
	PathBits          [TreeDepthV2]frontend.Variable
	PaymentAmount     frontend.Variable
	RecipientBlinding frontend.Variable
	ChangeBlinding    frontend.Variable
	RecipientIsLeft   frontend.Variable
	RequestDigest     frontend.Variable
}

func (c *SpendV2) Define(api frontend.API) error {
	range64(api, c.InputAmount)
	range64(api, c.PaymentAmount)
	api.AssertIsDifferent(c.InputAmount, 0)
	api.AssertIsDifferent(c.PaymentAmount, 0)
	api.AssertIsBoolean(c.RecipientIsLeft)

	api.AssertIsEqual(c.SenderOwner, ownerV2(api, c.Context, c.SpendKey))
	inputCommitment := hash(api, model.DomainNote, c.Context, c.InputAmount, c.SenderOwner, c.InputBlinding)
	assertTreeMembershipV2(api, inputCommitment, c.SpendRoot, c.PathSiblings, c.PathBits)

	changeAmount := api.Sub(c.InputAmount, c.PaymentAmount)
	range64(api, changeAmount)
	api.AssertIsDifferent(changeAmount, 0)
	recipientCommitment := hash(
		api,
		model.DomainNote,
		c.Context,
		c.PaymentAmount,
		c.RecipientOwner,
		c.RecipientBlinding,
	)
	changeCommitment := hash(
		api,
		model.DomainNote,
		c.Context,
		changeAmount,
		c.SenderOwner,
		c.ChangeBlinding,
	)
	api.AssertIsEqual(c.OutputLeft, api.Select(c.RecipientIsLeft, recipientCommitment, changeCommitment))
	api.AssertIsEqual(c.OutputRight, api.Select(c.RecipientIsLeft, changeCommitment, recipientCommitment))
	api.AssertIsEqual(c.Nullifier, hash(api, model.DomainNullifier, c.Context, c.SpendKey, inputCommitment))
	api.AssertIsEqual(
		c.PaymentIntent,
		hash(
			api,
			model.DomainPaymentIntent,
			c.Context,
			c.RequestDigest,
			c.PaymentAmount,
			c.SenderOwner,
			c.RecipientOwner,
			c.Payer,
			c.Merchant,
		),
	)
	return nil
}

type WithdrawV2 struct {
	Context          frontend.Variable `gnark:",public"`
	SpendRoot        frontend.Variable `gnark:",public"`
	Nullifier        frontend.Variable `gnark:",public"`
	ChangeCommitment frontend.Variable `gnark:",public"`
	Owner            frontend.Variable `gnark:",public"`
	ActionDigest     frontend.Variable `gnark:",public"`
	Amount           frontend.Variable `gnark:",public"`

	InputAmount    frontend.Variable
	SpendKey       frontend.Variable
	Payer          frontend.Variable
	Recipient      frontend.Variable
	InputBlinding  frontend.Variable
	PathSiblings   [TreeDepthV2]frontend.Variable
	PathBits       [TreeDepthV2]frontend.Variable
	ChangeBlinding frontend.Variable
}

func (c *WithdrawV2) Define(api frontend.API) error {
	range64(api, c.InputAmount)
	range64(api, c.Amount)
	api.AssertIsDifferent(c.InputAmount, 0)
	api.AssertIsDifferent(c.Amount, 0)

	api.AssertIsEqual(c.Owner, ownerV2(api, c.Context, c.SpendKey))
	api.AssertIsEqual(
		c.ActionDigest,
		withdrawalActionV2(api, c.Context, c.Owner, c.Payer, c.Recipient, c.Amount),
	)
	inputCommitment := hash(api, model.DomainNote, c.Context, c.InputAmount, c.Owner, c.InputBlinding)
	assertTreeMembershipV2(api, inputCommitment, c.SpendRoot, c.PathSiblings, c.PathBits)

	changeAmount := api.Sub(c.InputAmount, c.Amount)
	range64(api, changeAmount)
	changeCommitment := hash(api, model.DomainNote, c.Context, changeAmount, c.Owner, c.ChangeBlinding)
	api.AssertIsEqual(
		c.ChangeCommitment,
		api.Select(api.IsZero(changeAmount), 0, changeCommitment),
	)
	api.AssertIsEqual(c.Nullifier, hash(api, model.DomainNullifier, c.Context, c.SpendKey, inputCommitment))
	return nil
}

func withdrawalActionV2(api frontend.API, context, owner, payer, recipient, amount frontend.Variable) frontend.Variable {
	left := treeHashV2(api, model.DomainWithdrawalV2, context)
	left = treeHashV2(api, left, owner)
	left = treeHashV2(api, left, payer)
	return treeHashV2(api, left, treeHashV2(api, recipient, amount))
}

func ownerV2(api frontend.API, context, spendKey frontend.Variable) frontend.Variable {
	return hash(
		api,
		model.DomainOwnerV2,
		model.ProtocolVersionV2,
		model.BaseSepoliaChainID,
		context,
		spendKey,
	)
}

func identityActionV2(api frontend.API, context, owner, account, action, nonce frontend.Variable) frontend.Variable {
	left := treeHashV2(api, model.DomainIdentityV2, context)
	left = treeHashV2(api, left, owner)
	left = treeHashV2(api, left, account)
	return treeHashV2(api, left, treeHashV2(api, action, nonce))
}

func assertTreeMembershipV2(
	api frontend.API,
	commitment frontend.Variable,
	root frontend.Variable,
	siblings [TreeDepthV2]frontend.Variable,
	bits [TreeDepthV2]frontend.Variable,
) {
	current := commitment
	for index := 0; index < TreeDepthV2; index++ {
		api.AssertIsBoolean(bits[index])
		left := api.Select(bits[index], siblings[index], current)
		right := api.Select(bits[index], current, siblings[index])
		current = treeHashV2(api, left, right)
	}
	api.AssertIsEqual(current, root)
}

func treeHashV2(api frontend.API, left, right frontend.Variable) frontend.Variable {
	permutation, err := stdposeidon2.NewPoseidon2(api)
	if err != nil {
		panic(err)
	}
	return permutation.Compress(left, right)
}
