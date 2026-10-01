package model

import (
	"math/big"
	"testing"
)

func TestMerkleWitnessV2CoversEachPosition(t *testing.T) {
	leaves := []*big.Int{big.NewInt(11), big.NewInt(0), big.NewInt(22), big.NewInt(33), big.NewInt(44), big.NewInt(0)}
	var root *big.Int
	for index, leaf := range leaves {
		witness, err := MerkleWitnessForLeavesV2(leaves, uint64(index))
		if err != nil {
			t.Fatal(err)
		}
		calculated, err := RootFromWitnessV2(leaf, witness)
		if err != nil {
			t.Fatal(err)
		}
		if calculated.Cmp(witness.Root) != 0 {
			t.Fatalf("position %d has an invalid witness", index)
		}
		if root != nil && root.Cmp(witness.Root) != 0 {
			t.Fatal("the tree root changed by witness position")
		}
		root = witness.Root
	}
}
