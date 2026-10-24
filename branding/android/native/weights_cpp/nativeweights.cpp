#include <jni.h>
#include <vector>
#include <cstdint>
#include <cmath>
#include <cstring>
#include <algorithm>
#include <limits>

/**
 * Mobile-sized constrained graph harmonic relaxation (NOT libigl BBW).
 * Input/output: little-endian floats, each vertex has 3 local bone channels.
 * Locked vertices stay identical. Only mesh TOPOLOGY may diffuse weights.
 * Edges are vertex-id pairs; no geometric proximity shortcuts are used.
 */
static bool solveWeights(const std::vector<uint8_t>& raw,
                         const std::vector<uint8_t>& packedEdges,
                         const std::vector<uint8_t>& locks,
                         const int passes,
                         std::vector<uint8_t>& output) {
    const size_t n=locks.size();
    if(n==0||n>150000||raw.size()!=n*3*sizeof(float)||
       packedEdges.size()%8||packedEdges.size()/8>700000)return false;
    const size_t edgesCount=packedEdges.size()/8;
    std::vector<float> a(n*3),b(n*3);
    std::memcpy(a.data(),raw.data(),raw.size());
    for(const auto v:a)if(!std::isfinite(v)||v<0||v>1.00001f)return false;
    std::vector<uint32_t> degree(n,0),starts(n+1,0);
    for(size_t e=0;e<edgesCount;e++){
        uint32_t u,v;
        std::memcpy(&u,packedEdges.data()+e*8,4);
        std::memcpy(&v,packedEdges.data()+e*8+4,4);
        if(u>=n||v>=n)return false;
        if(u==v)continue;
        degree[u]++; degree[v]++;
    }
    for(size_t i=0;i<n;i++)starts[i+1]=starts[i]+degree[i];
    std::vector<uint32_t> neighbours(starts[n]);
    std::vector<uint32_t> cursor(starts.begin(),starts.end()-1);
    for(size_t e=0;e<edgesCount;e++){
        uint32_t u,v;
        std::memcpy(&u,packedEdges.data()+e*8,4);
        std::memcpy(&v,packedEdges.data()+e*8+4,4);
        if(u==v)continue;
        neighbours[cursor[u]++]=v;
        neighbours[cursor[v]++]=u;
    }
    const int iter=std::max(1,std::min(passes,100));
    for(int pass=0;pass<iter;pass++){
        for(size_t i=0;i<n;i++){
            const size_t off=i*3;
            if(locks[i]||degree[i]==0){
                b[off]=a[off];b[off+1]=a[off+1];b[off+2]=a[off+2];continue;
            }
            float sums[3]={0,0,0};
            for(uint32_t k=starts[i];k<starts[i+1];k++){
                const size_t at=size_t(neighbours[k])*3;
                sums[0]+=a[at];sums[1]+=a[at+1];sums[2]+=a[at+2];
            }
            const float factor=0.65f/float(degree[i]);
            float row[3];
            float total=0;
            for(int c=0;c<3;c++){
                row[c]=std::max(0.0f,a[off+c]*.35f+sums[c]*factor);
                total+=row[c];
            }
            if(total<1e-12f){
                b[off]=a[off];b[off+1]=a[off+1];b[off+2]=a[off+2];
            }else{
                for(int c=0;c<3;c++)b[off+c]=row[c]/total;
            }
        }
        a.swap(b);
    }
    output.resize(raw.size());
    std::memcpy(output.data(),a.data(),raw.size());
    return true;
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_rayzeng_animationstudio_xrstage7_NativeWeightsPlugin_solveNative(
    JNIEnv* env,jclass,jbyteArray values,jbyteArray edges,
    jbyteArray fixed,jint channels,jint passes) {
    if(channels!=3||!values||!edges||!fixed)return nullptr;
    const jsize valueLen=env->GetArrayLength(values);
    const jsize edgeLen=env->GetArrayLength(edges);
    const jsize fixedLen=env->GetArrayLength(fixed);
    if(valueLen<0||edgeLen<0||fixedLen<0||
       static_cast<size_t>(valueLen)!=static_cast<size_t>(fixedLen)*12 ||
       fixedLen>150000||edgeLen%8 ||edgeLen/8>700000)return nullptr;
    std::vector<uint8_t> v(valueLen),e(edgeLen),f(fixedLen),out;
    env->GetByteArrayRegion(values,0,valueLen,reinterpret_cast<jbyte*>(v.data()));
    env->GetByteArrayRegion(edges,0,edgeLen,reinterpret_cast<jbyte*>(e.data()));
    env->GetByteArrayRegion(fixed,0,fixedLen,reinterpret_cast<jbyte*>(f.data()));
    if(!solveWeights(v,e,f,passes,out))return nullptr;
    jbyteArray result=env->NewByteArray(static_cast<jsize>(out.size()));
    if(result)env->SetByteArrayRegion(result,0,static_cast<jsize>(out.size()),
                                     reinterpret_cast<jbyte*>(out.data()));
    return result;
}
