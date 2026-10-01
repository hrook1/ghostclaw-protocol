package model

import (
	"fmt"
	"math/big"

	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr/poseidon2"
)

var treePermutation = poseidon2.NewDefaultPermutation()

var ScalarFieldModulus, _ = new(big.Int).SetString(
	"21888242871839275222246405745257275088548364400416034343698204186575808495617",
	10,
)

// Tree compresses two canonical BN254 scalar-field elements with the Poseidon2
// parameters used by the circuit and the Base contract.
func Tree(left, right *big.Int) (*big.Int, error) {
	if left == nil || right == nil || left.Sign() < 0 || right.Sign() < 0 {
		return nil, fmt.Errorf("tree inputs must be non-negative field elements")
	}
	var leftElement, rightElement fr.Element
	if leftElement.SetBigInt(left).BigInt(new(big.Int)).Cmp(left) != 0 {
		return nil, fmt.Errorf("left tree input is outside the BN254 scalar field")
	}
	if rightElement.SetBigInt(right).BigInt(new(big.Int)).Cmp(right) != 0 {
		return nil, fmt.Errorf("right tree input is outside the BN254 scalar field")
	}
	leftBytes := leftElement.Bytes()
	rightBytes := rightElement.Bytes()
	digest, err := treePermutation.Compress(leftBytes[:], rightBytes[:])
	if err != nil {
		return nil, fmt.Errorf("poseidon2 tree compression: %w", err)
	}
	return new(big.Int).SetBytes(digest), nil
}

func MustTree(left, right *big.Int) *big.Int {
	value, err := Tree(left, right)
	if err != nil {
		panic(err)
	}
	return value
}
