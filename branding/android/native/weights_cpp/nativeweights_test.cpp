#include "nativeweights.cpp"
#include <cassert>
#include <cstdio>

static std::vector<uint8_t> fbytes(const std::vector<float>& values) {
 std::vector<uint8_t> result(values.size()*sizeof(float));
 std::memcpy(result.data(),values.data(),result.size());
 return result;
}
static std::vector<uint8_t> ebytes(const std::vector<uint32_t>& values) {
 std::vector<uint8_t> result(values.size()*sizeof(uint32_t));
 std::memcpy(result.data(),values.data(),result.size());
 return result;
}
int main() {
 std::vector<uint8_t> output;
 const auto raw=fbytes({1,0,0, 0.1f,0.9f,0, 0,1,0, 0,0,1});
 const auto edges=ebytes({0,1,1,2});
 const auto locks=std::vector<uint8_t>{1,0,1,0};
 assert(solveWeights(raw,edges,locks,32,output));
 std::vector<float> result(12);
 std::memcpy(result.data(),output.data(),output.size());
 assert(result[0]==1 && result[1]==0);
 assert(result[6]==0 && result[7]==1);
 assert(std::fabs(result[3]-.5f)<.01f);
 assert(std::fabs(result[4]-.5f)<.01f);
 assert(result[11]==1 && result[9]==0);
 assert(!solveWeights(raw,ebytes({0,99}),locks,32,output));
 assert(!solveWeights(raw,ebytes({0,1}),{1,0},32,output));
 std::puts("NativeWeights: graph constraints, isolation and bounds passed");
}
