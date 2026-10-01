package model

import (
	"fmt"
	"math/big"
)

const TreeDepthV2 = 20

type MerkleWitnessV2 struct {
	Root     *big.Int
	Siblings [TreeDepthV2]*big.Int
	Bits     [TreeDepthV2]uint8
}

func ZeroRootsV2() [TreeDepthV2 + 1]*big.Int {
	var roots [TreeDepthV2 + 1]*big.Int
	roots[0] = big.NewInt(0)
	for level := 1; level <= TreeDepthV2; level++ {
		roots[level] = MustTree(roots[level-1], roots[level-1])
	}
	return roots
}

func MerkleWitnessForLeavesV2(leaves []*big.Int, leafIndex uint64) (MerkleWitnessV2, error) {
	if len(leaves) == 0 || len(leaves) > 1<<TreeDepthV2 {
		return MerkleWitnessV2{}, fmt.Errorf("the v2 tree leaf count is invalid")
	}
	if leafIndex >= uint64(len(leaves)) {
		return MerkleWitnessV2{}, fmt.Errorf("the v2 tree leaf index is unavailable")
	}
	for index, leaf := range leaves {
		if leaf == nil || leaf.Sign() < 0 || leaf.Cmp(ScalarFieldModulus) >= 0 {
			return MerkleWitnessV2{}, fmt.Errorf("v2 tree leaf %d is outside the field", index)
		}
	}
	zeros := ZeroRootsV2()
	current := make([]*big.Int, len(leaves))
	for index := range leaves {
		current[index] = new(big.Int).Set(leaves[index])
	}
	position := int(leafIndex)
	var witness MerkleWitnessV2
	for level := 0; level < TreeDepthV2; level++ {
		witness.Bits[level] = uint8(position & 1)
		sibling := position ^ 1
		if sibling < len(current) {
			witness.Siblings[level] = new(big.Int).Set(current[sibling])
		} else {
			witness.Siblings[level] = new(big.Int).Set(zeros[level])
		}

		nextLength := (len(current) + 1) / 2
		next := make([]*big.Int, nextLength)
		for index := 0; index < nextLength; index++ {
			left := current[index*2]
			right := zeros[level]
			if index*2+1 < len(current) {
				right = current[index*2+1]
			}
			next[index] = MustTree(left, right)
		}
		current = next
		position >>= 1
	}
	if len(current) != 1 {
		return MerkleWitnessV2{}, fmt.Errorf("the v2 tree exceeds its configured depth")
	}
	witness.Root = current[0]
	return witness, nil
}

func RootFromWitnessV2(commitment *big.Int, witness MerkleWitnessV2) (*big.Int, error) {
	if commitment == nil || commitment.Sign() < 0 || commitment.Cmp(ScalarFieldModulus) >= 0 {
		return nil, fmt.Errorf("the v2 commitment is outside the field")
	}
	current := new(big.Int).Set(commitment)
	for level := 0; level < TreeDepthV2; level++ {
		if witness.Bits[level] > 1 || witness.Siblings[level] == nil {
			return nil, fmt.Errorf("the v2 Merkle witness is invalid")
		}
		if witness.Bits[level] == 0 {
			current = MustTree(current, witness.Siblings[level])
		} else {
			current = MustTree(witness.Siblings[level], current)
		}
	}
	return current, nil
}
