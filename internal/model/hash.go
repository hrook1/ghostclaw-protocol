package model

import (
	"math/big"

	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr/mimc"
)

const (
	DomainNote          = 2
	DomainNullifier     = 4
	DomainPaymentIntent = 5
	DomainOwnerV2       = 6
	DomainIdentityV2    = 7
	DomainWithdrawalV2  = 8
	ProtocolVersionV2   = 2
	BaseSepoliaChainID  = 84532
)

func Hash(values ...*big.Int) *big.Int {
	elements := make([]fr.Element, len(values))
	for i := range values {
		elements[i].SetBigInt(values[i])
	}
	sum := mimc.NewFieldHasher().SumElements(elements)
	return sum.BigInt(new(big.Int))
}

func Int(value uint64) *big.Int {
	return new(big.Int).SetUint64(value)
}

func OwnerV2(context, spendKey *big.Int) *big.Int {
	return Hash(
		Int(DomainOwnerV2),
		Int(ProtocolVersionV2),
		Int(BaseSepoliaChainID),
		context,
		spendKey,
	)
}

func IdentityActionV2(context, owner, account, action, nonce *big.Int) *big.Int {
	left := MustTree(Int(DomainIdentityV2), context)
	left = MustTree(left, owner)
	left = MustTree(left, account)
	return MustTree(left, MustTree(action, nonce))
}

func WithdrawalActionV2(context, owner, payer, recipient, amount *big.Int) *big.Int {
	left := MustTree(Int(DomainWithdrawalV2), context)
	left = MustTree(left, owner)
	left = MustTree(left, payer)
	return MustTree(left, MustTree(recipient, amount))
}

func Note(context, amount, owner, blinding *big.Int) *big.Int {
	return Hash(Int(DomainNote), context, amount, owner, blinding)
}

func Nullifier(context, spendKey, commitment *big.Int) *big.Int {
	return Hash(Int(DomainNullifier), context, spendKey, commitment)
}

func PaymentIntent(
	context, requestDigest, amount, senderOwner, recipientOwner, payer, merchant *big.Int,
) *big.Int {
	return Hash(
		Int(DomainPaymentIntent),
		context,
		requestDigest,
		amount,
		senderOwner,
		recipientOwner,
		payer,
		merchant,
	)
}
